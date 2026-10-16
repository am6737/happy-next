import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

// Minimal stand-in for a ws socket: records client frames, lets a test push server frames.
// Hoisted with vi.mock, so it can't use imports.
const { FakeSocket, sockets } = vi.hoisted(() => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
        static OPEN = 1;
        static CONNECTING = 0;
        readyState = 0;
        sent: Buffer[] = [];
        private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
        constructor() {
            sockets.push(this);
        }
        on(event: string, listener: (...args: unknown[]) => void) {
            this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
            return this;
        }
        emit(event: string, ...args: unknown[]) {
            for (const listener of this.listeners.get(event) ?? []) listener(...args);
        }
        open() {
            this.readyState = 1;
            this.emit('open');
        }
        send(data: Buffer, cb: (error?: Error) => void) {
            this.sent.push(data);
            cb();
        }
        close() {
            this.readyState = 3;
        }
    }
    return { FakeSocket, sockets };
});
vi.mock('ws', () => ({ default: FakeSocket }));

vi.mock('./env', () => ({
    env: {
        VOLC_TTS_APP_ID: 'app',
        VOLC_TTS_TOKEN: 'token',
        VOLC_TTS_VOICE: 'voice',
        VOLC_TTS_BIDI_RESOURCE_ID: 'seed-tts-2.0',
    },
}));

import {
    decodeTtsBidiFrame,
    decodeTtsBidiPayload,
    encodeTtsBidiClientFrame,
    synthesizeBidirectional,
    TtsBidiEvent,
    TtsBidiMessageType,
} from './ttsBidi';

const FLAG_WITH_EVENT = 0b0100;

function uint32(value: number) {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    return out;
}

function int32(value: number) {
    const out = Buffer.alloc(4);
    out.writeInt32BE(value);
    return out;
}

function serverFrame(options: {
    type: number;
    event?: number;
    sessionId?: string;
    connectId?: string;
    errorCode?: number;
    payload?: Buffer;
    compression?: number;
}) {
    const withEvent = options.event !== undefined;
    const parts: Buffer[] = [Buffer.from([
        0x11,
        (options.type << 4) | (withEvent ? FLAG_WITH_EVENT : 0),
        (1 << 4) | (options.compression ?? 0),
        0,
    ])];
    if (options.type === TtsBidiMessageType.Error) {
        parts.push(uint32(options.errorCode || 0));
    } else if (options.event !== undefined) {
        parts.push(int32(options.event));
        const identity = Buffer.from(options.connectId ?? options.sessionId ?? '');
        parts.push(uint32(identity.length), identity);
    }
    const payload = options.payload ?? Buffer.alloc(0);
    parts.push(uint32(payload.length), payload);
    return Buffer.concat(parts);
}

describe('Volcano TTS bidi frame codec', () => {
    it('encodes connection events without a session id', () => {
        const frame = encodeTtsBidiClientFrame(TtsBidiEvent.StartConnection, '{}');
        expect(frame.subarray(0, 4)).toEqual(Buffer.from([0x11, 0x14, 0x10, 0]));
        expect(frame.readInt32BE(4)).toBe(TtsBidiEvent.StartConnection);
        expect(frame.readUInt32BE(8)).toBe(2);
        expect(frame.subarray(12).toString()).toBe('{}');
    });

    it('encodes session events with session id and payload lengths', () => {
        const frame = encodeTtsBidiClientFrame(TtsBidiEvent.TaskRequest, '{"text":"你好"}', 'session-1');
        expect(frame.readInt32BE(4)).toBe(TtsBidiEvent.TaskRequest);
        expect(frame.readUInt32BE(8)).toBe(9);
        expect(frame.subarray(12, 21).toString()).toBe('session-1');
        const payloadLength = frame.readUInt32BE(21);
        expect(frame.subarray(25, 25 + payloadLength).toString()).toBe('{"text":"你好"}');
    });

    it('decodes a connection response and its connect id', () => {
        const decoded = decodeTtsBidiFrame(serverFrame({
            type: TtsBidiMessageType.FullServerResponse,
            event: TtsBidiEvent.ConnectionStarted,
            connectId: 'connect-1',
            payload: Buffer.from('{}'),
        }));
        expect(decoded.event).toBe(TtsBidiEvent.ConnectionStarted);
        expect(decoded.connectId).toBe('connect-1');
        expect(decoded.payload.toString()).toBe('{}');
    });

    it('decodes audio frames and gunzips compressed payloads', () => {
        const audio = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]);
        const decoded = decodeTtsBidiFrame(serverFrame({
            type: TtsBidiMessageType.AudioOnlyServer,
            event: 352,
            sessionId: 'session-1',
            payload: gzipSync(audio),
            compression: 1,
        }));
        expect(decoded.sessionId).toBe('session-1');
        expect(decodeTtsBidiPayload(decoded)).toEqual(audio);
    });

    it('decodes Error frames without treating the error code as an event', () => {
        const decoded = decodeTtsBidiFrame(serverFrame({
            type: TtsBidiMessageType.Error,
            errorCode: 45000001,
            payload: Buffer.from('{"message":"denied"}'),
        }));
        expect(decoded.event).toBeUndefined();
        expect(decoded.errorCode).toBe(45000001);
        expect(decoded.payload.toString()).toContain('denied');
    });

    it('rejects truncated frames instead of reading out of bounds', () => {
        expect(() => decodeTtsBidiFrame(Buffer.from([0x11, 0x90, 0x10, 0]))).toThrow(/Invalid TTS bidi frame/);
    });
});

describe('synthesizeBidirectional', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const serverEvent = (event: number) => serverFrame({ type: TtsBidiMessageType.FullServerResponse, event, payload: Buffer.from('{}') });
    const sentTexts = (socket: InstanceType<typeof FakeSocket>) => socket.sent
        .filter((frame) => frame.readInt32BE(4) === TtsBidiEvent.TaskRequest)
        .map((frame) => JSON.parse(frame.subarray(frame.indexOf('{')).toString()).req_params.text);
    const sentEvents = (socket: InstanceType<typeof FakeSocket>) => socket.sent.map((frame) => frame.readInt32BE(4));

    it('runs the text producer during the handshake and flushes its deltas in order once the session starts', async () => {
        let producerStarted = false;
        let emit!: (delta: string) => Promise<void>;
        let endText!: () => void;
        const done = synthesizeBidirectional({
            onAudio: vi.fn(),
            produceText: (sendText) => {
                producerStarted = true;
                emit = sendText;
                return new Promise<void>((resolve) => { endText = resolve; });
            },
        });
        const socket = sockets[sockets.length - 1];
        expect(producerStarted).toBe(true);

        await emit('第一句。');
        await emit('第二句');
        socket.open();
        socket.emit('message', serverEvent(TtsBidiEvent.ConnectionStarted));
        await flush();
        expect(sentTexts(socket)).toEqual([]);

        socket.emit('message', serverEvent(TtsBidiEvent.SessionStarted));
        await flush();
        await emit('还在继续。');
        expect(sentTexts(socket)).toEqual(['第一句。', '第二句', '还在继续。']);
        expect(sentEvents(socket)).not.toContain(TtsBidiEvent.FinishSession);

        endText();
        await flush();
        expect(sentEvents(socket).at(-1)).toBe(TtsBidiEvent.FinishSession);
        socket.emit('message', serverEvent(TtsBidiEvent.SessionFinished));
        await expect(done).resolves.toBeUndefined();
    });

    it('treats a producer failure during the handshake as a synthesis error, not a startup error', async () => {
        const done = synthesizeBidirectional({
            onAudio: vi.fn(),
            produceText: async () => { throw new Error('clean failed'); },
        });
        await expect(done).rejects.toMatchObject({ name: 'TtsBidiError', message: 'clean failed' });
    });
});

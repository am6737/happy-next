import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

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

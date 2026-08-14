import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import WebSocket, { type RawData } from 'ws';
import { env } from './env';

const TTS_BIDI_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
const FLAG_WITH_EVENT = 0b0100;
const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_NONE = 0b0000;
const COMPRESSION_GZIP = 0b0001;
const STARTUP_TIMEOUT_MS = 15_000;
const RUNNING_IDLE_TIMEOUT_MS = 60_000;

export const TtsBidiMessageType = {
    FullClientRequest: 0b0001,
    FullServerResponse: 0b1001,
    AudioOnlyServer: 0b1011,
    Error: 0b1111,
} as const;

export const TtsBidiEvent = {
    StartConnection: 1,
    FinishConnection: 2,
    ConnectionStarted: 50,
    ConnectionFailed: 51,
    ConnectionFinished: 52,
    StartSession: 100,
    CancelSession: 101,
    FinishSession: 102,
    SessionStarted: 150,
    SessionCanceled: 151,
    SessionFinished: 152,
    SessionFailed: 153,
    TaskRequest: 200,
} as const;

const CONNECTION_EVENTS = new Set<number>([
    TtsBidiEvent.StartConnection,
    TtsBidiEvent.FinishConnection,
    TtsBidiEvent.ConnectionStarted,
    TtsBidiEvent.ConnectionFailed,
    TtsBidiEvent.ConnectionFinished,
]);

export interface TtsBidiFrame {
    type: number;
    flags: number;
    serialization: number;
    compression: number;
    event?: number;
    sessionId?: string;
    connectId?: string;
    errorCode?: number;
    payload: Buffer;
}

function requireBytes(data: Buffer, offset: number, length: number) {
    if (offset < 0 || length < 0 || offset + length > data.length) {
        throw new Error(`Invalid TTS bidi frame: need ${length} bytes at ${offset}, frame has ${data.length}`);
    }
}

export function encodeTtsBidiClientFrame(event: number, payload: string, sessionId?: string): Buffer {
    const payloadBytes = Buffer.from(payload, 'utf8');
    const parts = [Buffer.from([
        (1 << 4) | 1,
        (TtsBidiMessageType.FullClientRequest << 4) | FLAG_WITH_EVENT,
        (SERIALIZATION_JSON << 4) | COMPRESSION_NONE,
        0,
    ])];

    const eventBytes = Buffer.alloc(4);
    eventBytes.writeInt32BE(event);
    parts.push(eventBytes);

    if (!CONNECTION_EVENTS.has(event)) {
        const sessionBytes = Buffer.from(sessionId || '', 'utf8');
        const sessionLength = Buffer.alloc(4);
        sessionLength.writeUInt32BE(sessionBytes.length);
        parts.push(sessionLength, sessionBytes);
    }

    const payloadLength = Buffer.alloc(4);
    payloadLength.writeUInt32BE(payloadBytes.length);
    parts.push(payloadLength, payloadBytes);
    return Buffer.concat(parts);
}

export function decodeTtsBidiFrame(data: Buffer): TtsBidiFrame {
    requireBytes(data, 0, 4);
    const version = data[0] >> 4;
    const headerSize = (data[0] & 0x0f) * 4;
    if (version !== 1 || headerSize < 4) {
        throw new Error(`Unsupported TTS bidi frame header: version=${version} size=${headerSize}`);
    }
    requireBytes(data, 0, headerSize);

    const frame: TtsBidiFrame = {
        type: data[1] >> 4,
        flags: data[1] & 0x0f,
        serialization: data[2] >> 4,
        compression: data[2] & 0x0f,
        payload: Buffer.alloc(0),
    };
    let offset = headerSize;

    // Volcano Error frames omit event; uint32 code starts immediately after the header.
    if (frame.type === TtsBidiMessageType.Error) {
        requireBytes(data, offset, 4);
        frame.errorCode = data.readUInt32BE(offset);
        offset += 4;
    } else if (frame.flags & FLAG_WITH_EVENT) {
        requireBytes(data, offset, 4);
        frame.event = data.readInt32BE(offset);
        offset += 4;

        if (!CONNECTION_EVENTS.has(frame.event)) {
            requireBytes(data, offset, 4);
            const sessionLength = data.readUInt32BE(offset);
            offset += 4;
            requireBytes(data, offset, sessionLength);
            frame.sessionId = data.subarray(offset, offset + sessionLength).toString('utf8');
            offset += sessionLength;
        } else if (frame.type === TtsBidiMessageType.FullServerResponse) {
            requireBytes(data, offset, 4);
            const connectLength = data.readUInt32BE(offset);
            offset += 4;
            requireBytes(data, offset, connectLength);
            frame.connectId = data.subarray(offset, offset + connectLength).toString('utf8');
            offset += connectLength;
        }
    }

    requireBytes(data, offset, 4);
    const payloadLength = data.readUInt32BE(offset);
    offset += 4;
    requireBytes(data, offset, payloadLength);
    frame.payload = data.subarray(offset, offset + payloadLength);
    return frame;
}

export function decodeTtsBidiPayload(frame: TtsBidiFrame): Buffer {
    if (frame.compression === COMPRESSION_NONE) return frame.payload;
    if (frame.compression === COMPRESSION_GZIP) return gunzipSync(frame.payload);
    throw new Error(`Unsupported TTS bidi compression: ${frame.compression}`);
}

export class TtsBidiError extends Error {
    readonly logId?: string;

    constructor(message: string, options: { cause?: unknown; logId?: string } = {}) {
        super(message, { cause: options.cause });
        this.name = 'TtsBidiError';
        this.logId = options.logId;
    }
}

export class TtsBidiStartupError extends TtsBidiError {
    constructor(message: string, options: { cause?: unknown; logId?: string } = {}) {
        super(message, options);
        this.name = 'TtsBidiStartupError';
    }
}

export interface TtsBidiSynthesisOptions {
    voiceType?: string;
    speechRate?: number;
    signal?: AbortSignal;
    onAudio: (chunk: Buffer) => void | Promise<void>;
    produceText: (sendText: (delta: string) => Promise<void>, signal: AbortSignal) => Promise<void>;
}

function rawDataToBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data);
}

function createAbortError() {
    const error = new Error('TTS bidi synthesis aborted');
    error.name = 'AbortError';
    return error;
}

function framePayloadText(frame: TtsBidiFrame): string {
    try {
        return decodeTtsBidiPayload(frame).toString('utf8').slice(0, 500);
    } catch {
        return `<binary ${frame.payload.length}B>`;
    }
}

/** Bidi TTS session: after SessionStarted, pass cleaned text deltas through unsplit. */
export async function synthesizeBidirectional(options: TtsBidiSynthesisOptions): Promise<void> {
    const connectId = randomUUID();
    const sessionId = randomUUID();
    const voiceType = options.voiceType || env.VOLC_TTS_VOICE;
    let logId: string | undefined;
    let sessionStarted = false;
    let sessionFinished = false;
    let settled = false;
    const producerController = new AbortController();

    await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(TTS_BIDI_URL, {
            headers: {
                'X-Api-App-Id': env.VOLC_TTS_APP_ID,
                'X-Api-App-Key': env.VOLC_TTS_APP_ID,
                'X-Api-Access-Key': env.VOLC_TTS_TOKEN,
                'X-Api-Resource-Id': env.VOLC_TTS_BIDI_RESOURCE_ID,
                'X-Api-Connect-Id': connectId,
            },
        });

        const startupTimer = setTimeout(() => {
            fail(new Error('TTS bidi startup timed out'));
        }, STARTUP_TIMEOUT_MS);
        startupTimer.unref();
        let runningIdleTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
            clearTimeout(startupTimer);
            if (runningIdleTimer) clearTimeout(runningIdleTimer);
            options.signal?.removeEventListener('abort', onAbort);
        };

        const refreshRunningIdleTimer = () => {
            if (!sessionStarted || settled) return;
            if (runningIdleTimer) clearTimeout(runningIdleTimer);
            runningIdleTimer = setTimeout(() => {
                fail(new Error('TTS bidi running idle timed out'));
            }, RUNNING_IDLE_TIMEOUT_MS);
            runningIdleTimer.unref();
        };

        const closeSocket = () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        function fail(error: unknown) {
            if (settled) return;
            settled = true;
            producerController.abort();
            cleanup();
            closeSocket();
            if (error instanceof Error && error.name === 'AbortError') {
                reject(error);
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            reject(sessionStarted
                ? new TtsBidiError(message, { cause: error, logId })
                : new TtsBidiStartupError(message, { cause: error, logId }));
        }

        const send = (event: number, payload: string, sid?: string) => new Promise<void>((resolveSend, rejectSend) => {
            if (ws.readyState !== WebSocket.OPEN) {
                rejectSend(new Error(`TTS bidi socket is not open (state=${ws.readyState})`));
                return;
            }
            ws.send(encodeTtsBidiClientFrame(event, payload, sid), (error) => {
                if (error) rejectSend(error);
                else resolveSend();
            });
        });

        const cancelAndClose = () => {
            if (sessionStarted && !sessionFinished && ws.readyState === WebSocket.OPEN) {
                ws.send(encodeTtsBidiClientFrame(TtsBidiEvent.CancelSession, '{}', sessionId), () => closeSocket());
            } else {
                closeSocket();
            }
        };

        function onAbort() {
            cancelAndClose();
            fail(createAbortError());
        }

        if (options.signal?.aborted) {
            onAbort();
            return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });

        ws.on('upgrade', (response) => {
            const value = response.headers['x-tt-logid'];
            logId = Array.isArray(value) ? value[0] : value;
        });

        ws.on('open', () => {
            void send(TtsBidiEvent.StartConnection, '{}').catch(fail);
        });

        ws.on('error', (error) => fail(error));
        ws.on('close', (code, reason) => {
            if (!settled && !sessionFinished) {
                fail(new Error(`TTS bidi socket closed early: code=${code} reason=${reason.toString() || '-'}`));
            }
        });

        ws.on('message', (data) => {
            void (async () => {
                refreshRunningIdleTimer();
                const frame = decodeTtsBidiFrame(rawDataToBuffer(data));
                if (frame.type === TtsBidiMessageType.Error) {
                    throw new Error(`TTS bidi error ${frame.errorCode}: ${framePayloadText(frame)}`);
                }

                if (frame.type === TtsBidiMessageType.AudioOnlyServer) {
                    const audio = decodeTtsBidiPayload(frame);
                    if (audio.length > 0) await options.onAudio(Buffer.from(audio));
                    return;
                }

                switch (frame.event) {
                    case TtsBidiEvent.ConnectionStarted:
                        await send(TtsBidiEvent.StartSession, JSON.stringify({
                            user: { uid: 'happy-voice' },
                            event: TtsBidiEvent.StartSession,
                            namespace: 'BidirectionalTTS',
                            req_params: {
                                speaker: voiceType,
                                audio_params: {
                                    format: 'mp3',
                                    sample_rate: 24000,
                                    speech_rate: Math.round(options.speechRate ?? 0),
                                },
                            },
                        }), sessionId);
                        break;
                    case TtsBidiEvent.ConnectionFailed:
                        throw new Error(`TTS bidi connection failed: ${framePayloadText(frame)}`);
                    case TtsBidiEvent.SessionStarted:
                        sessionStarted = true;
                        clearTimeout(startupTimer);
                        refreshRunningIdleTimer();
                        await options.produceText(async (delta) => {
                            if (!delta) return;
                            await send(TtsBidiEvent.TaskRequest, JSON.stringify({
                                user: { uid: 'happy-voice' },
                                event: TtsBidiEvent.TaskRequest,
                                namespace: 'BidirectionalTTS',
                                req_params: { text: delta },
                            }), sessionId);
                        }, producerController.signal);
                        if (options.signal?.aborted) throw createAbortError();
                        await send(TtsBidiEvent.FinishSession, '{}', sessionId);
                        break;
                    case TtsBidiEvent.SessionFailed:
                        throw new Error(`TTS bidi session failed: ${framePayloadText(frame)}`);
                    case TtsBidiEvent.SessionFinished:
                        sessionFinished = true;
                        await send(TtsBidiEvent.FinishConnection, '{}');
                        finish();
                        closeSocket();
                        break;
                }
            })().catch(fail);
        });
    });
}

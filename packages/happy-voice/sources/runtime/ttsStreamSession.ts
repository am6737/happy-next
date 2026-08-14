import { randomBytes } from 'node:crypto';
import { cleanForSpeech } from './cleanForSpeech';
import { env } from './env';
import { logError, logWarn } from './log';
import { synthesize } from './tts';
import { synthesizeBidirectional, TtsBidiStartupError } from './ttsBidi';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_DISCONNECT_GRACE_MS = 15_000;
const DEFAULT_MAX_ACTIVE = 8;
const DEFAULT_MAX_ACTIVE_PER_USER = 2;
const DEFAULT_PENDING_CLAIM_TIMEOUT_MS = 60_000;
const DEFAULT_COMPLETED_CHUNK_RELEASE_MS = 60_000;
const DEFAULT_REPLAY_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024;
const DEFAULT_SUBSCRIBER_BACKPRESSURE_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SUBSCRIBERS_PER_STREAM = 4;
const SENTENCE_BOUNDARY = /[。！？!?；;\n]/;
const MAX_SENTENCE = 60;

export interface TtsStreamInput {
    text: string;
    voiceType?: string;
    speechRate?: number;
}

export interface PreparedTtsStream {
    streamId: string;
    expiresAt: string;
}

export interface TtsAudioSubscriber {
    write(chunk: Buffer): boolean | void;
    end(): unknown;
    destroy(error?: Error): unknown;
    once?(event: 'drain', listener: () => void): unknown;
    off?(event: 'drain', listener: () => void): unknown;
    readonly bufferedBytes?: number;
}

export interface TtsStreamPipelineHandlers {
    onChunk: (chunk: Buffer) => Promise<void>;
}

export type TtsStreamPipeline = (
    input: TtsStreamInput,
    handlers: TtsStreamPipelineHandlers,
    signal: AbortSignal,
) => Promise<void>;

type TtsStreamState = 'pending' | 'running' | 'complete' | 'failed';

interface TtsSubscriberState {
    subscriber: TtsAudioSubscriber;
    live: boolean;
    closed: boolean;
    tail: Promise<void>;
    drainWaiters: Array<() => void>;
}

interface TtsStreamRecord extends PreparedTtsStream {
    input: TtsStreamInput;
    userId?: string;
    createdAtMs: number;
    expiresAtMs: number;
    absoluteExpiresAtMs: number;
    state: TtsStreamState;
    chunks: Buffer[];
    chunkBytes: number;
    nonReplayable: boolean;
    subscribers: Map<TtsAudioSubscriber, TtsSubscriberState>;
    controller: AbortController;
    expiryTimer?: ReturnType<typeof setTimeout>;
    pendingTimer?: ReturnType<typeof setTimeout>;
    disconnectTimer?: ReturnType<typeof setTimeout>;
    chunkReleaseTimer?: ReturnType<typeof setTimeout>;
}

export interface TtsStreamSessionRegistryOptions {
    startPipeline: TtsStreamPipeline;
    ttlMs?: number;
    absoluteTtlMs?: number;
    disconnectGraceMs?: number;
    maxActive?: number;
    maxActivePerUser?: number;
    pendingClaimTimeoutMs?: number;
    completedChunkReleaseMs?: number;
    replayBufferLimitBytes?: number;
    subscriberBackpressureLimitBytes?: number;
    maxSubscribersPerStream?: number;
    now?: () => number;
    onPipelineError?: (error: unknown, streamId: string) => void;
}

export type TtsStreamSubscribeResult =
    | { status: 'ok'; unsubscribe: () => void }
    | { status: 'not_found' }
    | { status: 'gone' }
    | { status: 'capacity' };

function unrefTimer(timer: ReturnType<typeof setTimeout>) {
    timer.unref?.();
    return timer;
}

export class TtsStreamSessionRegistry {
    private readonly sessions = new Map<string, TtsStreamRecord>();
    private readonly ttlMs: number;
    private readonly absoluteTtlMs: number;
    private readonly disconnectGraceMs: number;
    private readonly maxActive: number;
    private readonly maxActivePerUser: number;
    private readonly pendingClaimTimeoutMs: number;
    private readonly completedChunkReleaseMs: number;
    private readonly replayBufferLimitBytes: number;
    private readonly subscriberBackpressureLimitBytes: number;
    private readonly maxSubscribersPerStream: number;
    private readonly now: () => number;

    // Capability-token streams keep replay buffers bounded and respect HTTP backpressure.
    constructor(private readonly options: TtsStreamSessionRegistryOptions) {
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
        this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
        this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE;
        this.maxActivePerUser = options.maxActivePerUser ?? DEFAULT_MAX_ACTIVE_PER_USER;
        this.pendingClaimTimeoutMs = options.pendingClaimTimeoutMs ?? DEFAULT_PENDING_CLAIM_TIMEOUT_MS;
        this.completedChunkReleaseMs = options.completedChunkReleaseMs ?? DEFAULT_COMPLETED_CHUNK_RELEASE_MS;
        this.replayBufferLimitBytes = options.replayBufferLimitBytes ?? DEFAULT_REPLAY_BUFFER_LIMIT_BYTES;
        this.subscriberBackpressureLimitBytes = options.subscriberBackpressureLimitBytes ?? DEFAULT_SUBSCRIBER_BACKPRESSURE_LIMIT_BYTES;
        this.maxSubscribersPerStream = options.maxSubscribersPerStream ?? DEFAULT_MAX_SUBSCRIBERS_PER_STREAM;
        this.now = options.now ?? Date.now;
    }

    prepare(input: TtsStreamInput, userId?: string): PreparedTtsStream | null {
        if (this.activeCount() >= this.maxActive) return null;
        if (userId && this.activeCount(userId) >= this.maxActivePerUser) return null;

        const streamId = randomBytes(32).toString('base64url');
        const createdAtMs = this.now();
        const expiresAtMs = createdAtMs + this.ttlMs;
        const record: TtsStreamRecord = {
            streamId,
            input,
            userId,
            createdAtMs,
            expiresAt: new Date(expiresAtMs).toISOString(),
            expiresAtMs,
            absoluteExpiresAtMs: createdAtMs + this.absoluteTtlMs,
            state: 'pending',
            chunks: [],
            chunkBytes: 0,
            nonReplayable: false,
            subscribers: new Map(),
            controller: new AbortController(),
        };
        this.sessions.set(streamId, record);
        this.rescheduleExpiry(record);
        record.pendingTimer = unrefTimer(setTimeout(() => {
            if (record.state === 'pending' && record.subscribers.size === 0) this.release(record);
        }, this.pendingClaimTimeoutMs));
        return { streamId, expiresAt: record.expiresAt };
    }

    has(streamId: string): boolean {
        return !!this.getLive(streamId);
    }

    subscribe(streamId: string, subscriber: TtsAudioSubscriber): TtsStreamSubscribeResult {
        const record = this.getLive(streamId);
        if (!record) return { status: 'not_found' };
        if (record.nonReplayable) return { status: 'gone' };
        if (record.subscribers.size >= this.maxSubscribersPerStream) return { status: 'capacity' };

        if (record.disconnectTimer) {
            clearTimeout(record.disconnectTimer);
            record.disconnectTimer = undefined;
        }
        if (record.chunkReleaseTimer) {
            clearTimeout(record.chunkReleaseTimer);
            record.chunkReleaseTimer = undefined;
        }
        if (record.pendingTimer) {
            clearTimeout(record.pendingTimer);
            record.pendingTimer = undefined;
        }
        this.extendExpiryForActiveSubscribers(record);

        const state: TtsSubscriberState = {
            subscriber,
            live: false,
            closed: false,
            tail: Promise.resolve(),
            drainWaiters: [],
        };
        record.subscribers.set(subscriber, state);
        void this.attachSubscriber(record, state);
        if (record.state === 'pending') this.start(record);

        let detached = false;
        return { status: 'ok', unsubscribe: () => {
            if (detached) return;
            detached = true;
            state.closed = true;
            record.subscribers.delete(subscriber);
            if (record.subscribers.size === 0) {
                this.extendExpiryWithoutSubscribers(record);
                this.scheduleCompletedChunkRelease(record);
            }
            if (record.state === 'running' && record.subscribers.size === 0) {
                this.scheduleDisconnectRelease(record);
            }
        } };
    }

    activeCount(userId?: string): number {
        let count = 0;
        for (const record of this.sessions.values()) {
            if (userId && record.userId !== userId) continue;
            if (record.state === 'pending' || record.state === 'running') count++;
        }
        return count;
    }

    size(): number {
        return this.sessions.size;
    }

    private getLive(streamId: string): TtsStreamRecord | undefined {
        const record = this.sessions.get(streamId);
        if (!record) return undefined;
        if (this.now() >= record.absoluteExpiresAtMs || (record.subscribers.size === 0 && record.expiresAtMs <= this.now())) {
            this.expire(streamId);
            return undefined;
        }
        return record;
    }

    private start(record: TtsStreamRecord) {
        record.state = 'running';
        if (record.pendingTimer) {
            clearTimeout(record.pendingTimer);
            record.pendingTimer = undefined;
        }
        void this.options.startPipeline(record.input, {
            onChunk: (chunk) => this.publish(record, chunk),
        }, record.controller.signal).then(() => {
            if (this.sessions.get(record.streamId) !== record) return;
            record.state = 'complete';
            this.endSubscribers(record);
            this.scheduleCompletedChunkRelease(record);
        }).catch((error) => {
            if (this.sessions.get(record.streamId) !== record) return;
            record.state = 'failed';
            this.destroySubscribers(record, error instanceof Error ? error : undefined);
            this.scheduleCompletedChunkRelease(record);
            if (!record.controller.signal.aborted) {
                this.options.onPipelineError?.(error, record.streamId);
            }
        });
    }

    private async publish(record: TtsStreamRecord, chunk: Buffer) {
        if (this.sessions.get(record.streamId) !== record || record.state !== 'running' || chunk.length === 0) return;
        const stored = Buffer.from(chunk);
        if (!record.nonReplayable && record.chunkBytes + stored.length <= this.replayBufferLimitBytes) {
            record.chunks.push(stored);
            record.chunkBytes += stored.length;
        } else if (!record.nonReplayable) {
            record.chunks = [];
            record.chunkBytes = 0;
            record.nonReplayable = true;
        }
        const targets = Array.from(record.subscribers.values())
            .filter((state) => state.live || record.nonReplayable);
        await Promise.all(targets.map((state) => this.enqueueWrite(record, state, stored)));
        if (record.subscribers.size === 0) this.scheduleDisconnectRelease(record);
    }

    private async attachSubscriber(record: TtsStreamRecord, state: TtsSubscriberState) {
        let index = 0;
        try {
            while (!state.closed && !record.nonReplayable && index < record.chunks.length) {
                await this.enqueueWrite(record, state, record.chunks[index]);
                index++;
            }
            if (state.closed || this.sessions.get(record.streamId) !== record) return;
            if (record.nonReplayable) {
                this.dropSubscriber(record, state, 'destroy', new Error('TTS stream is no longer replayable'));
                return;
            }
            if (record.state === 'complete') {
                await state.tail;
                this.dropSubscriber(record, state, 'end');
                return;
            }
            if (record.state === 'failed') {
                await state.tail;
                this.dropSubscriber(record, state, 'destroy', new Error('TTS stream synthesis failed'));
                return;
            }
            state.live = true;
        } catch (error) {
            this.dropSubscriber(record, state, 'destroy', error instanceof Error ? error : undefined);
        }
    }

    private enqueueWrite(record: TtsStreamRecord, state: TtsSubscriberState, chunk: Buffer): Promise<void> {
        state.tail = state.tail.then(() => this.writeWithBackpressure(record, state, chunk));
        state.tail.catch(() => undefined);
        return state.tail;
    }

    private async writeWithBackpressure(record: TtsStreamRecord, state: TtsSubscriberState, chunk: Buffer) {
        if (state.closed) return;
        let drained = true;
        try {
            drained = state.subscriber.write(chunk) !== false;
        } catch (error) {
            this.dropSubscriber(record, state, 'destroy', error instanceof Error ? error : undefined);
            return;
        }
        if (drained || state.closed) return;
        if ((state.subscriber.bufferedBytes ?? 0) > this.subscriberBackpressureLimitBytes) {
            this.dropSubscriber(record, state, 'destroy', new Error('TTS subscriber backpressure limit exceeded'));
            return;
        }
        await new Promise<void>((resolve, reject) => {
            if (state.closed) {
                resolve();
                return;
            }
            const onDrain = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                state.subscriber.off?.('drain', onDrain);
                const index = state.drainWaiters.indexOf(onDrain);
                if (index >= 0) state.drainWaiters.splice(index, 1);
            };
            if (!state.subscriber.once) {
                resolve();
                return;
            }
            state.drainWaiters.push(onDrain);
            state.subscriber.once('drain', onDrain);
            state.tail.catch((error) => {
                cleanup();
                reject(error);
            });
        });
    }

    private endSubscribers(record: TtsStreamRecord) {
        if (record.disconnectTimer) {
            clearTimeout(record.disconnectTimer);
            record.disconnectTimer = undefined;
        }
        for (const state of Array.from(record.subscribers.values())) {
            this.dropSubscriber(record, state, 'end');
        }
    }

    private destroySubscribers(record: TtsStreamRecord, error?: Error) {
        if (record.disconnectTimer) {
            clearTimeout(record.disconnectTimer);
            record.disconnectTimer = undefined;
        }
        for (const state of Array.from(record.subscribers.values())) {
            this.dropSubscriber(record, state, 'destroy', error);
        }
    }

    private dropSubscriber(record: TtsStreamRecord, state: TtsSubscriberState, mode: 'end' | 'destroy', error?: Error) {
        if (state.closed) return;
        state.closed = true;
        for (const waiter of state.drainWaiters.splice(0)) waiter();
        record.subscribers.delete(state.subscriber);
        try {
            if (mode === 'end') state.subscriber.end();
            else state.subscriber.destroy(error);
        } catch {
        }
        if (record.subscribers.size === 0) {
            this.extendExpiryWithoutSubscribers(record);
            this.scheduleCompletedChunkRelease(record);
        }
    }

    private scheduleDisconnectRelease(record: TtsStreamRecord) {
        if (record.disconnectTimer || record.state !== 'running') return;
        record.disconnectTimer = unrefTimer(setTimeout(() => {
            record.disconnectTimer = undefined;
            if (record.state === 'running' && record.subscribers.size === 0) {
                this.release(record);
            }
        }, this.disconnectGraceMs));
    }

    private scheduleCompletedChunkRelease(record: TtsStreamRecord) {
        if ((record.state !== 'complete' && record.state !== 'failed') || record.subscribers.size > 0 || record.chunkReleaseTimer || record.chunks.length === 0) return;
        record.chunkReleaseTimer = unrefTimer(setTimeout(() => {
            record.chunkReleaseTimer = undefined;
            if ((record.state === 'complete' || record.state === 'failed') && record.subscribers.size === 0) {
                record.chunks = [];
                record.chunkBytes = 0;
                record.nonReplayable = true;
            }
        }, this.completedChunkReleaseMs));
    }

    private extendExpiryForActiveSubscribers(record: TtsStreamRecord) {
        if (this.sessions.get(record.streamId) !== record) return;
        record.expiresAtMs = Math.min(this.now() + this.ttlMs, record.absoluteExpiresAtMs);
        this.rescheduleExpiry(record);
    }

    private extendExpiryWithoutSubscribers(record: TtsStreamRecord) {
        if (this.sessions.get(record.streamId) !== record || record.subscribers.size > 0) return;
        record.expiresAtMs = Math.min(this.now() + this.ttlMs, record.absoluteExpiresAtMs);
        this.rescheduleExpiry(record);
    }

    private rescheduleExpiry(record: TtsStreamRecord) {
        if (record.expiryTimer) clearTimeout(record.expiryTimer);
        const dueAt = Math.min(record.expiresAtMs, record.absoluteExpiresAtMs);
        record.expiryTimer = unrefTimer(setTimeout(() => this.handleExpiry(record.streamId), Math.max(0, dueAt - this.now())));
    }

    private handleExpiry(streamId: string) {
        const record = this.sessions.get(streamId);
        if (!record) return;
        if (this.now() >= record.absoluteExpiresAtMs) {
            this.release(record);
            return;
        }
        if (record.subscribers.size > 0) {
            this.extendExpiryForActiveSubscribers(record);
            return;
        }
        if (this.now() >= record.expiresAtMs) this.release(record);
        else this.rescheduleExpiry(record);
    }

    private expire(streamId: string) {
        const record = this.sessions.get(streamId);
        if (!record) return;
        this.release(record);
    }

    private release(record: TtsStreamRecord) {
        if (this.sessions.get(record.streamId) !== record) return;
        this.sessions.delete(record.streamId);
        record.state = 'failed';
        if (record.expiryTimer) clearTimeout(record.expiryTimer);
        if (record.pendingTimer) clearTimeout(record.pendingTimer);
        if (record.disconnectTimer) clearTimeout(record.disconnectTimer);
        if (record.chunkReleaseTimer) clearTimeout(record.chunkReleaseTimer);
        record.controller.abort();
        this.destroySubscribers(record, new Error('TTS stream expired'));
    }
}

async function cleanIntoBidi(input: TtsStreamInput, signal: AbortSignal, sendText: (delta: string) => Promise<void>) {
    const complete = await cleanForSpeech(input.text, sendText, signal);
    if (!complete && !signal.aborted) {
        logWarn('TTS bidi text cleaning ended after partial output', { chars: input.text.length });
        throw new Error('TTS bidi text cleaning ended after partial output');
    }
}

async function streamRestFallback(
    input: TtsStreamInput,
    handlers: TtsStreamPipelineHandlers,
    signal: AbortSignal,
) {
    let buffer = '';

    const sendSentence = async (raw: string) => {
        const sentence = raw.trim();
        if (!sentence || signal.aborted) return;
        const result = await synthesize(sentence, {
            voiceType: input.voiceType,
            speechRate: input.speechRate,
            signal,
        });
        if (!signal.aborted) await handlers.onChunk(Buffer.from(result.audioBase64, 'base64'));
    };

    const drain = async (final: boolean) => {
        for (;;) {
            const match = buffer.match(SENTENCE_BOUNDARY);
            if (match?.index !== undefined) {
                const cut = match.index + 1;
                await sendSentence(buffer.slice(0, cut));
                buffer = buffer.slice(cut);
                continue;
            }
            if (buffer.length > MAX_SENTENCE) {
                await sendSentence(buffer.slice(0, MAX_SENTENCE));
                buffer = buffer.slice(MAX_SENTENCE);
                continue;
            }
            break;
        }
        if (final && buffer.trim()) {
            await sendSentence(buffer);
            buffer = '';
        }
    };

    const complete = await cleanForSpeech(input.text, async (piece) => {
        buffer += piece;
        await drain(false);
    }, signal);
    await drain(true);
    if (!complete && !signal.aborted) {
        logWarn('TTS REST fallback text cleaning ended after partial output', { chars: input.text.length });
        throw new Error('TTS REST fallback text cleaning ended after partial output');
    }
}

export const startTtsStreamPipeline: TtsStreamPipeline = async (input, handlers, signal) => {
    if (env.TTS_BIDI_ENABLED) {
        try {
            await synthesizeBidirectional({
                voiceType: input.voiceType,
                speechRate: input.speechRate,
                signal,
                onAudio: handlers.onChunk,
                produceText: (sendText, producerSignal) => cleanIntoBidi(input, producerSignal, sendText),
            });
            return;
        } catch (error) {
            if (!(error instanceof TtsBidiStartupError) || signal.aborted) throw error;
            logWarn('TTS bidi startup failed; using REST fallback', {
                error: error.message,
                logId: error.logId,
            });
        }
    }

    await streamRestFallback(input, handlers, signal);
};

export const ttsStreamSessionStore = new TtsStreamSessionRegistry({
    startPipeline: startTtsStreamPipeline,
    onPipelineError: (error) => {
        logError('TTS stream synthesis ended early', { error });
    },
});

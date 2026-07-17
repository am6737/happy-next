import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('./env', () => ({
    env: {
        TTS_BIDI_ENABLED: true,
        VOLC_TTS_APP_ID: 'app',
        VOLC_TTS_TOKEN: 'token',
        VOLC_TTS_CLUSTER: 'cluster',
        VOLC_TTS_VOICE: 'voice',
        VOLC_TTS_BIDI_RESOURCE_ID: 'seed-tts-2.0',
    },
}));
vi.mock('./log', () => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('./cleanForSpeech', () => ({ cleanForSpeech: vi.fn() }));
vi.mock('./tts', () => ({ synthesize: vi.fn() }));
vi.mock('./ttsBidi', () => {
    class TtsBidiStartupError extends Error {
        logId?: string;

        constructor(message: string, options: { logId?: string } = {}) {
            super(message);
            this.logId = options.logId;
        }
    }
    return {
        TtsBidiStartupError,
        synthesizeBidirectional: vi.fn(),
    };
});

import {
    startTtsStreamPipeline,
    TtsStreamSessionRegistry,
    type TtsAudioSubscriber,
    type TtsStreamPipeline,
    type TtsStreamPipelineHandlers,
} from './ttsStreamSession';
import { cleanForSpeech } from './cleanForSpeech';
import { env } from './env';
import { synthesize } from './tts';
import { synthesizeBidirectional, TtsBidiStartupError } from './ttsBidi';

const mockClean = vi.mocked(cleanForSpeech);
const mockSynthesize = vi.mocked(synthesize);
const mockBidi = vi.mocked(synthesizeBidirectional);

function makeSubscriber() {
    const chunks: Buffer[] = [];
    let ended = 0;
    let destroyed = 0;
    const subscriber: TtsAudioSubscriber = {
        write: (chunk) => { chunks.push(Buffer.from(chunk)); },
        end: () => { ended++; },
        destroy: () => { destroyed++; },
    };
    return {
        subscriber,
        text: () => Buffer.concat(chunks).toString(),
        ended: () => ended,
        destroyed: () => destroyed,
    };
}

function makeBackpressureSubscriber(options: { bufferedBytes?: number } = {}) {
    const events = new EventEmitter();
    const chunks: Buffer[] = [];
    let ended = 0;
    let destroyed = 0;
    let shouldDrain = false;
    const subscriber: TtsAudioSubscriber = {
        write: (chunk) => {
            chunks.push(Buffer.from(chunk));
            if (shouldDrain) {
                shouldDrain = false;
                return false;
            }
            return true;
        },
        end: () => { ended++; },
        destroy: () => { destroyed++; },
        once: (event, listener) => events.once(event, listener),
        off: (event, listener) => events.off(event, listener),
        get bufferedBytes() {
            return options.bufferedBytes ?? 0;
        },
    };
    return {
        subscriber,
        text: () => Buffer.concat(chunks).toString(),
        ended: () => ended,
        destroyed: () => destroyed,
        blockNextWrite: () => { shouldDrain = true; },
        drain: () => events.emit('drain'),
    };
}

async function flushMicrotasks() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

function deferredPipeline() {
    let handlers: TtsStreamPipelineHandlers | undefined;
    let signal: AbortSignal | undefined;
    let resolve: (() => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const start: TtsStreamPipeline = vi.fn(async (_input, nextHandlers, nextSignal) => {
        handlers = nextHandlers;
        signal = nextSignal;
        await new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
    });
    return {
        start,
        handlers: () => handlers!,
        signal: () => signal!,
        resolve: () => resolve!(),
        reject: (error: unknown) => reject!(error),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
    env.TTS_BIDI_ENABLED = true;
    mockClean.mockReset();
    mockClean.mockImplementation(async (text, onText) => {
        await onText(text);
        return true;
    });
    mockSynthesize.mockReset();
    mockSynthesize.mockResolvedValue({
        audioBase64: Buffer.from('rest-mp3').toString('base64'),
        mimeType: 'audio/mpeg',
    });
    mockBidi.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('TtsStreamSessionRegistry', () => {
    it('starts synthesis once, broadcasts live chunks, and replays from byte zero', async () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start });
        const prepared = store.prepare({ text: 'hello' })!;
        const first = makeSubscriber();
        const second = makeSubscriber();

        expect(store.subscribe(prepared.streamId, first.subscriber).status).toBe('ok');
        expect(pipeline.start).toHaveBeenCalledOnce();
        await pipeline.handlers().onChunk(Buffer.from('one'));
        await flushMicrotasks();

        expect(store.subscribe(prepared.streamId, second.subscriber).status).toBe('ok');
        await flushMicrotasks();
        expect(second.text()).toBe('one');
        await pipeline.handlers().onChunk(Buffer.from('two'));
        await flushMicrotasks();
        expect(first.text()).toBe('onetwo');
        expect(second.text()).toBe('onetwo');

        pipeline.resolve();
        await flushMicrotasks();
        expect(first.ended()).toBe(1);
        expect(second.ended()).toBe(1);
        expect(store.activeCount()).toBe(0);

        const replay = makeSubscriber();
        expect(store.subscribe(prepared.streamId, replay.subscriber).status).toBe('ok');
        await vi.waitFor(() => {
            expect(replay.text()).toBe('onetwo');
            expect(replay.ended()).toBe(1);
        });
        expect(pipeline.start).toHaveBeenCalledOnce();
    });

    it('allows reconnect during the 15 second grace period', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({
            startPipeline: pipeline.start,
            disconnectGraceMs: 15_000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        const first = makeSubscriber();
        const subscription = store.subscribe(prepared.streamId, first.subscriber);
        expect(subscription.status).toBe('ok');
        if (subscription.status === 'ok') subscription.unsubscribe();

        vi.advanceTimersByTime(14_999);
        expect(store.has(prepared.streamId)).toBe(true);
        const second = makeSubscriber();
        expect(store.subscribe(prepared.streamId, second.subscriber).status).toBe('ok');
        vi.advanceTimersByTime(1);
        expect(store.has(prepared.streamId)).toBe(true);
        expect(pipeline.signal().aborted).toBe(false);
    });

    it('cancels and releases a running stream after the disconnect grace period', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({
            startPipeline: pipeline.start,
            disconnectGraceMs: 15_000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        const target = makeSubscriber();
        const subscription = store.subscribe(prepared.streamId, target.subscriber);
        expect(subscription.status).toBe('ok');
        if (subscription.status === 'ok') subscription.unsubscribe();

        vi.advanceTimersByTime(15_000);
        expect(pipeline.signal().aborted).toBe(true);
        expect(store.has(prepared.streamId)).toBe(false);
        expect(store.size()).toBe(0);
    });

    it('keeps completed audio until the fixed prepare TTL, then expires it', async () => {
        const start: TtsStreamPipeline = async (_input, handlers) => {
            handlers.onChunk(Buffer.from('mp3'));
        };
        const store = new TtsStreamSessionRegistry({ startPipeline: start, ttlMs: 60_000 });
        const prepared = store.prepare({ text: 'hello' })!;
        expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('ok');
        await flushMicrotasks();

        vi.advanceTimersByTime(59_999);
        expect(store.has(prepared.streamId)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(store.has(prepared.streamId)).toBe(false);
    });

    it('returns no reservation when the active prepare limit is reached', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start, maxActive: 1 });
        const prepared = store.prepare({ text: 'first' });
        expect(prepared).not.toBeNull();
        expect(Buffer.from(prepared!.streamId, 'base64url')).toHaveLength(32);
        expect(store.prepare({ text: 'second' })).toBeNull();
    });

    it('treats unknown and synchronously expired tokens as missing', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start, ttlMs: 1000 });
        const prepared = store.prepare({ text: 'hello' })!;
        expect(store.has('unknown')).toBe(false);
        vi.setSystemTime(new Date('2026-07-16T00:00:01.000Z'));
        expect(store.has(prepared.streamId)).toBe(false);
    });

    it('marks oversized replay buffers as non-replayable and rejects later GETs with gone', async () => {
        const start: TtsStreamPipeline = async (_input, handlers) => {
            await handlers.onChunk(Buffer.from('1234'));
            await handlers.onChunk(Buffer.from('5'));
        };
        const store = new TtsStreamSessionRegistry({
            startPipeline: start,
            replayBufferLimitBytes: 4,
            completedChunkReleaseMs: 60_000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        const live = makeSubscriber();
        expect(store.subscribe(prepared.streamId, live.subscriber).status).toBe('ok');
        await vi.waitFor(() => expect(live.text()).toBe('12345'));
        expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('gone');
    });

    it('releases completed chunks after 60 seconds while keeping the record as gone until TTL', async () => {
        const start: TtsStreamPipeline = async (_input, handlers) => {
            await handlers.onChunk(Buffer.from('mp3'));
        };
        const store = new TtsStreamSessionRegistry({
            startPipeline: start,
            ttlMs: 600_000,
            completedChunkReleaseMs: 60_000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        const first = makeSubscriber();
        expect(store.subscribe(prepared.streamId, first.subscriber).status).toBe('ok');
        await vi.waitFor(() => expect(first.ended()).toBe(1));
        vi.advanceTimersByTime(59_999);
        expect(store.has(prepared.streamId)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('gone');
        expect(store.has(prepared.streamId)).toBe(true);
    });

    it('waits for drain when a subscriber applies backpressure', async () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start });
        const slow = makeBackpressureSubscriber();
        expect(store.subscribe(store.prepare({ text: 'hello' })!.streamId, slow.subscriber).status).toBe('ok');
        slow.blockNextWrite();
        const publish = pipeline.handlers().onChunk(Buffer.from('one'));
        await flushMicrotasks();
        let settled = false;
        publish.then(() => { settled = true; });
        await flushMicrotasks();
        expect(settled).toBe(false);
        slow.drain();
        await publish;
        expect(slow.text()).toBe('one');
    });

    it('destroys a subscriber whose pending write buffer exceeds 4MB', async () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({
            startPipeline: pipeline.start,
            subscriberBackpressureLimitBytes: 4,
        });
        const slow = makeBackpressureSubscriber({ bufferedBytes: 5 });
        expect(store.subscribe(store.prepare({ text: 'hello' })!.streamId, slow.subscriber).status).toBe('ok');
        slow.blockNextWrite();
        await pipeline.handlers().onChunk(Buffer.from('one'));
        expect(slow.destroyed()).toBe(1);
    });

    it('destroys subscribers instead of ending cleanly when synthesis fails mid-stream', async () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start });
        const prepared = store.prepare({ text: 'hello' })!;
        const subscriber = makeSubscriber();
        expect(store.subscribe(prepared.streamId, subscriber.subscriber).status).toBe('ok');
        await pipeline.handlers().onChunk(Buffer.from('partial'));
        pipeline.reject(new Error('socket closed mid-stream'));
        await vi.waitFor(() => expect(subscriber.destroyed()).toBe(1));
        expect(subscriber.ended()).toBe(0);
    });

    it('limits one stream to four concurrent subscribers', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start, maxSubscribersPerStream: 4 });
        const prepared = store.prepare({ text: 'hello' })!;
        for (let i = 0; i < 4; i++) {
            expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('ok');
        }
        expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('capacity');
    });

    it('slides expiry while a subscriber is online but enforces the absolute cap', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({
            startPipeline: pipeline.start,
            ttlMs: 1000,
            absoluteTtlMs: 3000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        expect(store.subscribe(prepared.streamId, makeSubscriber().subscriber).status).toBe('ok');
        vi.advanceTimersByTime(1000);
        expect(store.has(prepared.streamId)).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(store.has(prepared.streamId)).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(store.has(prepared.streamId)).toBe(false);
    });

    it('releases unclaimed pending streams after 60 seconds', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({
            startPipeline: pipeline.start,
            pendingClaimTimeoutMs: 60_000,
        });
        const prepared = store.prepare({ text: 'hello' })!;
        vi.advanceTimersByTime(59_999);
        expect(store.has(prepared.streamId)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(store.has(prepared.streamId)).toBe(false);
    });

    it('limits active prepared streams per authenticated user to two', () => {
        const pipeline = deferredPipeline();
        const store = new TtsStreamSessionRegistry({ startPipeline: pipeline.start, maxActivePerUser: 2 });
        expect(store.prepare({ text: 'first' }, 'user-1')).not.toBeNull();
        expect(store.prepare({ text: 'second' }, 'user-1')).not.toBeNull();
        expect(store.prepare({ text: 'third' }, 'user-1')).toBeNull();
        expect(store.prepare({ text: 'other' }, 'user-2')).not.toBeNull();
        expect(store.prepare({ text: 'anonymous' })).not.toBeNull();
    });
});

describe('startTtsStreamPipeline fallback boundary', () => {
    it('falls back to sentence REST synthesis when bidi session startup fails', async () => {
        mockBidi.mockRejectedValue(new TtsBidiStartupError('startup failed', { logId: 'log-id' }));
        const chunks: Buffer[] = [];
        await startTtsStreamPipeline({ text: '第一句。第二句。' }, {
            onChunk: async (chunk) => { chunks.push(chunk); },
        }, new AbortController().signal);

        expect(mockBidi).toHaveBeenCalledOnce();
        expect(mockSynthesize).toHaveBeenCalledTimes(2);
        expect(Buffer.concat(chunks).toString()).toBe('rest-mp3rest-mp3');
    });

    it('does not restart with REST after a post-start bidi failure', async () => {
        mockBidi.mockRejectedValue(new Error('socket closed mid-stream'));
        await expect(startTtsStreamPipeline({ text: 'hello' }, {
            onChunk: async () => undefined,
        }, new AbortController().signal)).rejects.toThrow('socket closed mid-stream');
        expect(mockSynthesize).not.toHaveBeenCalled();
    });

    it('uses REST directly when the operations switch is disabled', async () => {
        env.TTS_BIDI_ENABLED = false;
        const chunks: Buffer[] = [];
        await startTtsStreamPipeline({ text: 'hello' }, {
            onChunk: async (chunk) => { chunks.push(chunk); },
        }, new AbortController().signal);
        expect(mockBidi).not.toHaveBeenCalled();
        expect(mockSynthesize).toHaveBeenCalledOnce();
        expect(Buffer.concat(chunks).toString()).toBe('rest-mp3');
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable fake backend: records every startPlayback and lets tests fire
// its callbacks / inspect stop() calls.
const backend = vi.hoisted(() => {
    const plays: {
        text: string;
        cb: { onPlaying: () => void; onDone: () => void };
        stopped: boolean;
    }[] = [];
    return {
        plays,
        startPlayback: vi.fn((text: string, cb: { onPlaying: () => void; onDone: () => void }) => {
            const rec = { text, cb, stopped: false };
            plays.push(rec);
            return { stop: () => { rec.stopped = true; } };
        }),
        primeForGesture: vi.fn(),
        onQueueIdle: vi.fn(),
    };
});

vi.mock('./ttsPlayerBackend', () => ({
    startPlayback: backend.startPlayback,
    primeForGesture: backend.primeForGesture,
    onQueueIdle: backend.onQueueIdle,
}));

type Queue = typeof import('./messageTtsQueue');

const A = { messageId: 'a', sessionId: 's1', text: 'text a' };
const B = { messageId: 'b', sessionId: 's1', text: 'text b' };
const C = { messageId: 'c', sessionId: 's2', text: 'text c' };

let q: Queue;

beforeEach(async () => {
    backend.plays.length = 0;
    backend.startPlayback.mockClear();
    backend.primeForGesture.mockClear();
    backend.onQueueIdle.mockClear();
    vi.resetModules(); // fresh module-level queue state per test
    q = await import('./messageTtsQueue');
});

describe('messageTtsQueue', () => {
    it('plays immediately when idle and reports loading → playing', () => {
        q.toggleMessageTts(A);
        expect(backend.primeForGesture).toHaveBeenCalled();
        expect(backend.startPlayback).toHaveBeenCalledOnce();
        expect(q.getTtsQueueSnapshot()).toMatchObject({ current: A, phase: 'loading', queue: [] });

        backend.plays[0].cb.onPlaying();
        expect(q.getTtsQueueSnapshot().phase).toBe('playing');
    });

    it('enqueues while something is playing; toggling a queued item removes it', () => {
        q.toggleMessageTts(A);
        q.toggleMessageTts(B);
        q.toggleMessageTts(C);
        expect(backend.startPlayback).toHaveBeenCalledOnce();
        expect(q.getTtsQueueSnapshot().queue).toEqual([B, C]);

        q.toggleMessageTts(B); // queued → dequeue
        expect(q.getTtsQueueSnapshot().queue).toEqual([C]);
        expect(backend.startPlayback).toHaveBeenCalledOnce();
    });

    it('natural end advances to the next item, then goes idle and releases the session', () => {
        q.toggleMessageTts(A);
        q.toggleMessageTts(B);

        backend.plays[0].cb.onDone();
        expect(backend.startPlayback).toHaveBeenCalledTimes(2);
        expect(backend.plays[1].text).toBe('text b');
        expect(q.getTtsQueueSnapshot()).toMatchObject({ current: B, phase: 'loading', queue: [] });
        expect(backend.onQueueIdle).not.toHaveBeenCalled();

        backend.plays[1].cb.onDone();
        expect(q.getTtsQueueSnapshot()).toMatchObject({ current: null, phase: 'idle', queue: [] });
        expect(backend.onQueueIdle).toHaveBeenCalledOnce();
    });

    it('toggling the playing message stops it and continues with the queue', () => {
        q.toggleMessageTts(A);
        q.toggleMessageTts(B);

        q.toggleMessageTts(A);
        expect(backend.plays[0].stopped).toBe(true);
        expect(q.getTtsQueueSnapshot().current).toEqual(B);
        expect(backend.startPlayback).toHaveBeenCalledTimes(2);
    });

    it('skipCurrentTts stops the current item and advances; no-op when idle', () => {
        q.skipCurrentTts(); // idle: nothing happens
        expect(backend.startPlayback).not.toHaveBeenCalled();

        q.toggleMessageTts(A);
        q.toggleMessageTts(B);
        q.skipCurrentTts();
        expect(backend.plays[0].stopped).toBe(true);
        expect(q.getTtsQueueSnapshot().current).toEqual(B);

        q.skipCurrentTts(); // queue empty → idle
        expect(q.getTtsQueueSnapshot()).toMatchObject({ current: null, phase: 'idle' });
        expect(backend.onQueueIdle).toHaveBeenCalledOnce();
    });

    it('removeQueuedTts removes only the given item and notifies once', () => {
        const seen: unknown[] = [];
        q.toggleMessageTts(A);
        q.toggleMessageTts(B);
        q.toggleMessageTts(C);
        const unsub = q.subscribeTtsQueue(() => seen.push(q.getTtsQueueSnapshot().queue.length));

        q.removeQueuedTts('b');
        expect(q.getTtsQueueSnapshot().queue).toEqual([C]);
        q.removeQueuedTts('nope'); // unknown id → no notification
        expect(seen).toEqual([1]);
        unsub();
    });

    it('ignores stale callbacks from a replaced playback (generation guard)', () => {
        q.toggleMessageTts(A);
        const stale = backend.plays[0].cb;
        q.toggleMessageTts(B); // enqueue
        q.skipCurrentTts(); // A stopped, B starts

        stale.onDone(); // must not advance/stop B
        expect(q.getTtsQueueSnapshot().current).toEqual(B);
        stale.onPlaying(); // must not flip B (still loading) to playing
        expect(q.getTtsQueueSnapshot().phase).toBe('loading');
    });

    it('restarting after idle works (fresh generation)', () => {
        q.toggleMessageTts(A);
        backend.plays[0].cb.onDone();
        expect(q.getTtsQueueSnapshot().phase).toBe('idle');

        q.toggleMessageTts(B);
        expect(q.getTtsQueueSnapshot()).toMatchObject({ current: B, phase: 'loading' });
        backend.plays[1].cb.onPlaying();
        expect(q.getTtsQueueSnapshot().phase).toBe('playing');
    });
});

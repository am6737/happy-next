import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechStreamStatus } from '@/sync/apiHappyVoice';

vi.mock('@/sync/apiHappyVoice', () => ({
    fetchSpeechStreamStatus: vi.fn(),
    speechStreamUrlFrom: (url: string, from: number) => (from > 0 ? `${url}?from=${from.toFixed(3)}` : url),
}));

import { playResumableStream, type SourceEvents } from './resumableStream';

const URL = 'https://gw/v1/voice/tts/stream/abc/audio.mp3';

function setup(statuses: Array<SpeechStreamStatus | null | Error>) {
    const sources: { url: string; events: SourceEvents; stopped: boolean }[] = [];
    const cb = { onPlaying: vi.fn(), onLoading: vi.fn(), onDone: vi.fn() };
    const fetchStatus = vi.fn(async () => {
        const next = statuses.shift();
        if (next instanceof Error) throw next;
        return next ?? null;
    });
    const handle = playResumableStream({
        url: URL,
        open: (url, events) => {
            const rec = { url, events, stopped: false };
            sources.push(rec);
            return { stop: () => { rec.stopped = true; } };
        },
        fetchStatus,
        ...cb,
    });
    return { sources, cb, fetchStatus, handle, last: () => sources[sources.length - 1] };
}

const complete = (durationSeconds: number): SpeechStreamStatus => ({ state: 'complete', durationSeconds, replayable: true });
const running = (durationSeconds: number): SpeechStreamStatus => ({ state: 'running', durationSeconds, replayable: true });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('playResumableStream', () => {
    it('finishes when the stream ends after everything synthesized was heard', async () => {
        const t = setup([complete(10)]);
        t.last().events.playing();
        t.last().events.progress(9.5);
        t.last().events.ended();
        await vi.runOnlyPendingTimersAsync();
        expect(t.cb.onPlaying).toHaveBeenCalledOnce();
        expect(t.cb.onDone).toHaveBeenCalledOnce();
        expect(t.cb.onLoading).not.toHaveBeenCalled();
        expect(t.sources).toHaveLength(1);
    });

    it('resumes a dropped stream from the last heard position, slightly rewound', async () => {
        const t = setup([running(20), complete(30)]);
        t.last().events.playing();
        t.last().events.progress(12);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.sources[0].stopped).toBe(true);
        expect(t.cb.onLoading).toHaveBeenCalledOnce();
        expect(t.last().url).toBe(`${URL}?from=11.500`);

        // The new source's clock starts at its own zero.
        t.last().events.playing();
        t.last().events.progress(18.6);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.cb.onPlaying).toHaveBeenCalledTimes(2);
        expect(t.cb.onDone).toHaveBeenCalledOnce();
    });

    it('treats a stalled position as a drop', async () => {
        const t = setup([running(20)]);
        t.last().events.playing();
        t.last().events.progress(3);
        await vi.advanceTimersByTimeAsync(12000);
        expect(t.sources).toHaveLength(2);
        expect(t.last().url).toBe(`${URL}?from=2.500`);
    });

    it('retries the status check with backoff while offline, then resumes', async () => {
        const t = setup([new Error('offline'), new Error('offline'), running(20)]);
        t.last().events.playing();
        t.last().events.progress(5);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.fetchStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(t.fetchStatus).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1999);
        expect(t.fetchStatus).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(t.fetchStatus).toHaveBeenCalledTimes(3);
        expect(t.sources).toHaveLength(2);
        expect(t.cb.onDone).not.toHaveBeenCalled();
    });

    it('gives up once an interruption outlasts the recovery budget', async () => {
        const t = setup(Array.from({ length: 50 }, () => new Error('offline')));
        t.last().events.playing();
        t.last().events.progress(5);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(35000);
        expect(t.cb.onDone).toHaveBeenCalledOnce();
    });

    it('gives up when the gateway no longer has the stream', async () => {
        const t = setup([null]);
        t.last().events.playing();
        t.last().events.progress(5);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.cb.onDone).toHaveBeenCalledOnce();
        expect(t.sources).toHaveLength(1);
    });

    it('trusts the end of a source that never reported a position', async () => {
        const t = setup([running(20)]);
        t.last().events.playing();
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.fetchStatus).not.toHaveBeenCalled();
        expect(t.cb.onDone).toHaveBeenCalledOnce();
    });

    it('stops quietly, ignoring later events and pending retries', async () => {
        const t = setup([new Error('offline'), running(20)]);
        t.last().events.playing();
        t.last().events.progress(5);
        t.last().events.ended();
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();
        await vi.advanceTimersByTimeAsync(10000);
        expect(t.sources).toHaveLength(1);
        expect(t.cb.onDone).not.toHaveBeenCalled();
    });
});

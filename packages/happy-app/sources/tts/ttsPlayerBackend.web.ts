import { prepareSpeechStream } from '@/sync/apiHappyVoice';
import type { PlaybackCallbacks, PlaybackHandle } from './types';

// Web playback backend: ONE persistent HTMLAudioElement reused for every queue
// item. Safari grants play() permission per element and only within user
// activation, and queue auto-advance happens outside any gesture — a fresh
// element per item (the pre-queue approach) would go silent after item one.

// ~1ms of silence, used to prime the element inside the tap gesture: Safari
// needs a play() that actually starts to mark the element user-activated
// (src-less play() just rejects).
const SILENT_WAV = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';

let audioEl: HTMLAudioElement | null = null;

/** Create + unlock the shared element; must run synchronously inside a tap. */
export function primeForGesture() {
    if (audioEl) return;
    audioEl = new Audio(SILENT_WAV);
    audioEl.play().catch(() => { /* priming is best-effort */ });
}

export function startPlayback(text: string, cb: PlaybackCallbacks): PlaybackHandle {
    let stopped = false;
    let done = false;
    const ac = new AbortController();
    // Defensive: a start without a prior prime only happens outside a gesture
    // path we control; non-Safari browsers still play fine.
    primeForGesture();
    const audio = audioEl!;

    const finish = () => {
        if (done || stopped) return;
        done = true;
        cb.onDone();
    };

    (async () => {
        const { url } = await prepareSpeechStream(text, ac.signal);
        if (stopped) return;
        // 'playing' fires once audio is audibly out; stay loading until then.
        audio.onplaying = () => {
            if (!stopped && !done) cb.onPlaying();
        };
        // Server closes the stream at end of synthesis (natural end) and
        // destroys the socket on mid-stream failure (error); never surfaced.
        audio.onended = finish;
        audio.onerror = finish;
        audio.src = url;
        audio.play().catch(finish);
    })().catch(finish);

    return {
        stop: () => {
            if (stopped || done) return;
            stopped = true;
            ac.abort();
            // Clearing src aborts the download; handlers are detached first so
            // the resulting error event can't leak into the next item.
            try {
                audio.onplaying = null;
                audio.onended = null;
                audio.onerror = null;
                audio.pause();
                audio.src = '';
            } catch { /* already torn down */ }
        },
    };
}

/** iOS audio-session bookkeeping — nothing to release on web. */
export function onQueueIdle() { }

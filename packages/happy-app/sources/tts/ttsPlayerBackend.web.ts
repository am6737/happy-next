import { prepareSpeechStream } from '@/sync/apiHappyVoice';
import { playResumableStream, type SourceEvents, type StreamSource } from './resumableStream';
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

/** Point the shared element at one stream source; resumes reuse the element. */
function openSource(url: string, events: SourceEvents): StreamSource {
    const audio = audioEl!;
    // 'playing' fires once audio is audibly out; stay loading until then.
    audio.onplaying = () => events.playing();
    audio.ontimeupdate = () => events.progress(audio.currentTime);
    // A closed stream ends the element whether synthesis finished or the
    // connection dropped, and a broken one errors; the caller tells apart.
    audio.onended = () => events.ended();
    audio.onerror = () => events.ended();
    audio.src = url;
    audio.play().catch(() => events.ended());
    return {
        stop: () => {
            // Clearing src aborts the download; handlers are detached first so
            // the resulting error event can't leak into the next source.
            try {
                audio.onplaying = null;
                audio.ontimeupdate = null;
                audio.onended = null;
                audio.onerror = null;
                audio.pause();
                audio.src = '';
            } catch { /* already torn down */ }
        },
    };
}

export function startPlayback(text: string, cb: PlaybackCallbacks): PlaybackHandle {
    let stopped = false;
    let stream: { stop: () => void } | null = null;
    const ac = new AbortController();
    // Defensive: a start without a prior prime only happens outside a gesture
    // path we control; non-Safari browsers still play fine.
    primeForGesture();

    prepareSpeechStream(text, ac.signal).then(({ url }) => {
        if (stopped) return;
        stream = playResumableStream({ url, open: openSource, ...cb });
    }).catch(() => {
        if (!stopped) cb.onDone();
    });

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            ac.abort();
            stream?.stop();
        },
    };
}

/** iOS audio-session bookkeeping — nothing to release on web. */
export function onQueueIdle() { }

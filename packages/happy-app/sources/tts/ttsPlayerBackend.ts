import { createAudioPlayer, setIsAudioActiveAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { prepareSpeechStream } from '@/sync/apiHappyVoice';
import { setPlaybackAudioMode } from '@/utils/microphonePermissions';
import { isVoiceSessionStarted } from '@/realtime/RealtimeSession';
import { playResumableStream, type SourceEvents, type StreamSource } from './resumableStream';
import type { PlaybackCallbacks, PlaybackHandle } from './types';

// Native playback backend: one createAudioPlayer per stream source, playing a
// gateway-prepared chunked mp3 URL (no duration, not seekable). Drops are
// resumed by playResumableStream, which reopens a fresh player from the last
// heard position. Detached from React on purpose — the old
// useAudioPlayer-based hook died with its component.

/** No-op on native; the web backend primes its audio element here. */
export function primeForGesture() { }

/** Swallow NativeSharedObjectNotFoundException when expo-audio released the player under us. */
function safeCall(fn: () => void) {
    try { fn(); } catch { /* player released; nothing to do */ }
}

function openSource(url: string, events: SourceEvents): StreamSource {
    // keepAudioSessionActive: without it expo-audio deactivates the shared
    // iOS session ~100ms after playback ends, racing the next item's
    // startup and killing it silently; we release via onQueueIdle instead.
    const p = createAudioPlayer(url, { keepAudioSessionActive: true });
    let stopped = false;
    let playing = false;
    const sub = p.addListener('playbackStatusUpdate', (status) => {
        if (stopped) return;
        // loading → playing only once audio is actually coming out: the
        // chunked stream buffers after play(), so play() ≠ audible.
        if (status.playing && !playing) {
            playing = true;
            events.playing();
        }
        events.progress(status.currentTime);
        // The server closing the stream surfaces as didJustFinish — whether
        // synthesis finished or the connection dropped; the caller tells apart.
        // iOS reports errors as 'failed'; Android collapses them into 'idle',
        // which is only meaningful once playing ('idle' is also pre-load).
        if (status.didJustFinish || status.playbackState === 'failed' || (status.playbackState === 'idle' && playing)) {
            events.ended();
        }
    });
    safeCall(() => p.play());
    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            sub.remove();
            // Deferred: remove() from inside the player's own status callback
            // would re-enter native mid-dispatch.
            setTimeout(() => safeCall(() => { p.pause(); p.remove(); }), 0);
        },
    };
}

export function startPlayback(text: string, cb: PlaybackCallbacks): PlaybackHandle {
    let stopped = false;
    let stream: { stop: () => void } | null = null;
    const ac = new AbortController();

    (async () => {
        // Force loudspeaker (iOS defaults to the earpiece; the voice flow can
        // leave the session in record mode). Skip during a call — switching
        // off recording would cut the call's mic.
        if (!isVoiceSessionStarted()) {
            await setPlaybackAudioMode();
        }
        if (stopped) return;
        const { url } = await prepareSpeechStream(text, ac.signal);
        if (stopped) return;
        stream = playResumableStream({ url, open: openSource, ...cb });
    })().catch(() => {
        // Prepare failed or was aborted — never surfaced; the queue just advances.
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

/**
 * Release the shared audio session once the queue is fully idle (so other
 * apps' audio resumes) — keepAudioSessionActive disables expo-audio's own
 * deactivation. iOS only: on Android setIsAudioActiveAsync(false) sets a
 * module-wide audioEnabled=false that no later play() re-enables. Never touch
 * the session during a voice call — the RTC engine owns it there.
 */
export function onQueueIdle() {
    if (Platform.OS !== 'ios') return;
    if (isVoiceSessionStarted()) return;
    setIsAudioActiveAsync(false).catch(() => { /* session busy; harmless */ });
}

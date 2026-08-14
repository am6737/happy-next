import { createAudioPlayer, setIsAudioActiveAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { prepareSpeechStream } from '@/sync/apiHappyVoice';
import { setPlaybackAudioMode } from '@/utils/microphonePermissions';
import { isVoiceSessionStarted } from '@/realtime/RealtimeSession';
import type { PlaybackCallbacks, PlaybackHandle } from './types';

// Native playback backend: one createAudioPlayer per queue item, streaming a
// gateway-prepared chunked mp3 URL (no duration, not seekable). The server
// closes the stream at end of synthesis (natural finish) and destroys the
// socket on mid-stream failure. Detached from React on purpose — the old
// useAudioPlayer-based hook died with its component.

// Load-failure deadline after play(): iOS emits no 'failed' status on load
// errors and Android's error 'idle' is only recognizable once playing, so a
// dead source would otherwise stay on loading forever.
const START_WATCHDOG_MS = 15000;

/** No-op on native; the web backend primes its audio element here. */
export function primeForGesture() { }

/** Swallow NativeSharedObjectNotFoundException when expo-audio released the player under us. */
function safeCall(fn: () => void) {
    try { fn(); } catch { /* player released; nothing to do */ }
}

export function startPlayback(text: string, cb: PlaybackCallbacks): PlaybackHandle {
    let stopped = false;
    let done = false;
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    let sub: { remove(): void } | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const ac = new AbortController();

    const teardown = () => {
        if (watchdog !== null) {
            clearTimeout(watchdog);
            watchdog = null;
        }
        sub?.remove();
        sub = null;
        const p = player;
        player = null;
        if (p) {
            // Deferred: remove() from inside the player's own status callback
            // would re-enter native mid-dispatch.
            setTimeout(() => safeCall(() => { p.pause(); p.remove(); }), 0);
        }
    };

    const finish = () => {
        if (done || stopped) return;
        done = true;
        teardown();
        cb.onDone();
    };

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
        // keepAudioSessionActive: without it expo-audio deactivates the shared
        // iOS session ~100ms after playback ends, racing the next item's
        // startup and killing it silently; we release via onQueueIdle instead.
        const p = createAudioPlayer(url, { keepAudioSessionActive: true });
        player = p;
        let playing = false;
        sub = p.addListener('playbackStatusUpdate', (status) => {
            if (done || stopped) return;
            // loading → playing only once audio is actually coming out: the
            // chunked stream buffers after play(), so play() ≠ audible.
            if (status.playing && !playing) {
                playing = true;
                if (watchdog !== null) {
                    clearTimeout(watchdog);
                    watchdog = null;
                }
                cb.onPlaying();
            }
            // Natural end: the server closing the stream surfaces as didJustFinish.
            if (status.didJustFinish) {
                finish();
                return;
            }
            // iOS reports 'failed'; Android collapses errors into 'idle', which
            // is only meaningful once playing ('idle' is also the pre-load state).
            if (status.playbackState === 'failed' || (status.playbackState === 'idle' && playing)) {
                finish();
            }
        });
        safeCall(() => p.play());
        watchdog = setTimeout(() => {
            watchdog = null;
            finish();
        }, START_WATCHDOG_MS);
    })().catch(() => {
        // Prepare failed or was aborted — never surfaced; the queue just advances.
        finish();
    });

    return {
        stop: () => {
            if (stopped || done) return;
            stopped = true;
            ac.abort();
            teardown();
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

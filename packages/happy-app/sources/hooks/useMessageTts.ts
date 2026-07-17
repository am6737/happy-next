import { useAudioPlayer, useAudioPlayerStatus, setIsAudioActiveAsync } from 'expo-audio';
import { Platform } from 'react-native';
import * as React from 'react';
import { prepareSpeechStream } from '@/sync/apiHappyVoice';
import { setPlaybackAudioMode } from '@/utils/microphonePermissions';
import { isVoiceSessionStarted } from '@/realtime/RealtimeSession';

export type MessageTtsState = 'idle' | 'loading' | 'playing';

// Single active playback across all messages (singleton across mounts).
let currentPlayingId: string | null = null;
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(fn => fn()); }

// Load-failure deadline after play(): iOS emits no 'failed' status on load
// errors and Android's error 'idle' is only recognizable once playing, so a
// dead source would otherwise stay on loading forever.
const START_WATCHDOG_MS = 15000;

/** Swallow NativeSharedObjectNotFoundException when expo-audio released the player under us. */
function safePlayerCall(fn: () => void) {
    try { fn(); } catch { /* player released; nothing to do */ }
}

/**
 * Release the shared audio session once playback truly ends (so other apps'
 * audio resumes) — keepAudioSessionActive disables expo-audio's own
 * deactivation. iOS only: on Android setIsAudioActiveAsync(false) sets a
 * module-wide audioEnabled=false that no later play() re-enables. Never touch
 * the session during a voice call — the RTC engine owns it there.
 */
function releaseAudioSession() {
    if (Platform.OS !== 'ios') return;
    if (isVoiceSessionStarted()) return;
    // Playback changed hands since the release was decided — keep the session
    // for the new owner (the async native call would land after its play()).
    if (currentPlayingId !== null) return;
    setIsAudioActiveAsync(false).catch(() => { /* session busy; harmless */ });
}

/**
 * Native "read message aloud": a single expo-audio player streams one
 * gateway-prepared chunked mp3 URL (no duration, not seekable). The server
 * closes the stream at end of synthesis (natural finish) and destroys the
 * socket on mid-stream failure (playback error or stall).
 */
export function useMessageTts(messageId: string, text: string | null | undefined) {
    const [uri, setUri] = React.useState<string | null>(null);
    const [internalState, setInternalState] = React.useState<MessageTtsState>('idle');
    // keepAudioSessionActive: without it expo-audio deactivates the shared iOS
    // session ~100ms after playback ends, racing the next playback's startup
    // and killing it silently; we release via releaseAudioSession() instead.
    const player = useAudioPlayer(uri || undefined, { keepAudioSessionActive: true });
    const status = useAudioPlayerStatus(player);
    const [, force] = React.useReducer((x: number) => x + 1, 0);

    const stoppedRef = React.useRef(false);
    const startingRef = React.useRef(false);
    const pendingPlayRef = React.useRef(false);
    const abortRef = React.useRef<AbortController | null>(null);
    const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // useAudioPlayerStatus keeps reporting the previous player's last event
    // until the new one emits — gate status-driven transitions on the id.
    const statusIsCurrent = status.id === player.id;

    React.useEffect(() => {
        listeners.add(force);
        return () => { listeners.delete(force); };
    }, []);

    const clearWatchdog = React.useCallback(() => {
        if (watchdogRef.current !== null) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    }, []);

    const reset = React.useCallback(() => {
        stoppedRef.current = true;
        abortRef.current?.abort();
        abortRef.current = null;
        // Free the start lock now — an immediate re-toggle must not find it held.
        startingRef.current = false;
        clearWatchdog();
        safePlayerCall(() => player.pause());
        pendingPlayRef.current = false;
        setUri(null);
        setInternalState('idle');
    }, [player, clearWatchdog]);

    // Reset when the message text changes (streamed/edited messages).
    React.useEffect(() => {
        if (currentPlayingId === messageId) {
            currentPlayingId = null;
            notifyAll();
            releaseAudioSession();
        }
        reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text]);

    // Lost playback ownership with work still in flight → quiesce everything.
    // Not gated on status.playing (it lags play(); a still-buffering stream
    // would start sounding later). Also aborts a pending prepare.
    React.useEffect(() => {
        if (currentPlayingId === messageId) return;
        if (uri === null && abortRef.current === null && watchdogRef.current === null && internalState === 'idle') return;
        reset();
    });

    // Start a newly-set source. Not gated on status.isLoaded (stale event, or
    // deadlock if the new player's event beats the subscription); an early
    // play() is safe. pendingPlayRef keeps it to one play() per source.
    React.useEffect(() => {
        if (pendingPlayRef.current && uri && currentPlayingId === messageId) {
            pendingPlayRef.current = false;
            safePlayerCall(() => player.play());
            clearWatchdog();
            watchdogRef.current = setTimeout(() => {
                watchdogRef.current = null;
                if (currentPlayingId !== messageId) return;
                currentPlayingId = null;
                reset();
                notifyAll();
                releaseAudioSession();
            }, START_WATCHDOG_MS);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri, messageId]);

    // loading → playing only once audio is actually coming out: the chunked
    // stream buffers after play(), so play() alone does not mean audible.
    React.useEffect(() => {
        if (!statusIsCurrent || currentPlayingId !== messageId) return;
        if (status.playing && internalState === 'loading') {
            clearWatchdog();
            setInternalState('playing');
        }
    }, [status.playing, statusIsCurrent, messageId, internalState, clearWatchdog]);

    // Natural end: the server closing the stream surfaces as didJustFinish.
    React.useEffect(() => {
        if (!statusIsCurrent || !status.didJustFinish || currentPlayingId !== messageId) return;
        currentPlayingId = null;
        setInternalState('idle');
        notifyAll();
        releaseAudioSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.didJustFinish, statusIsCurrent, messageId]);

    // Failure → silently back to idle. iOS reports 'failed'; Android collapses
    // errors into 'idle', meaningful only once playing ('idle' is also the
    // pre-load state). Failures that emit neither are the watchdog's job.
    const playbackFailed = status.playbackState === 'failed'
        || (status.playbackState === 'idle' && internalState === 'playing');
    React.useEffect(() => {
        if (!statusIsCurrent || !playbackFailed || currentPlayingId !== messageId) return;
        currentPlayingId = null;
        reset();
        notifyAll();
        releaseAudioSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playbackFailed, statusIsCurrent, messageId]);

    // Clear the global singleton on unmount if this message owned playback.
    React.useEffect(() => {
        return () => {
            abortRef.current?.abort();
            abortRef.current = null;
            clearWatchdog();
            if (currentPlayingId === messageId) {
                currentPlayingId = null;
                notifyAll();
                releaseAudioSession();
            }
        };
    }, [messageId, clearWatchdog]);

    const isMine = currentPlayingId === messageId;
    const state: MessageTtsState = isMine ? internalState : 'idle';

    const toggle = React.useCallback(async () => {
        if (!text) return;

        // Active for this message → stop.
        if (isMine && internalState !== 'idle') {
            currentPlayingId = null;
            reset();
            notifyAll();
            releaseAudioSession();
            return;
        }
        if (startingRef.current) return;

        startingRef.current = true;
        stoppedRef.current = false;
        pendingPlayRef.current = false;
        // Defensive: setUri with an identical string would skip the re-render
        // that starts playback (urls are freshly tokenized, so unexpected).
        setUri(null);
        currentPlayingId = messageId;
        setInternalState('loading');
        notifyAll();

        // Force loudspeaker (iOS defaults to the earpiece; the voice flow can
        // leave the session in record mode). Skip during a call — switching
        // off recording would cut the call's mic.
        if (!isVoiceSessionStarted()) {
            await setPlaybackAudioMode();
        }
        // Stopped or taken over while the audio-mode switch was in flight.
        if (stoppedRef.current || currentPlayingId !== messageId) {
            startingRef.current = false;
            return;
        }

        const ac = new AbortController();
        abortRef.current = ac;
        try {
            const { url } = await prepareSpeechStream(text, ac.signal);
            if (stoppedRef.current || currentPlayingId !== messageId) return;
            pendingPlayRef.current = true;
            setUri(url);
        } catch {
            // Prepare failed or was aborted — never surfaced; drop back to idle.
            if (currentPlayingId === messageId) {
                currentPlayingId = null;
                setInternalState('idle');
                notifyAll();
                releaseAudioSession();
            }
        } finally {
            // reset() may have released the lock and a newer run may already
            // hold it — only the run that still owns abortRef frees it.
            if (abortRef.current === ac) {
                abortRef.current = null;
                startingRef.current = false;
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, isMine, internalState, messageId, reset]);

    return { state, toggle };
}

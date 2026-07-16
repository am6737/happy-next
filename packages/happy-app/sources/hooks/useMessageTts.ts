import { useAudioPlayer, useAudioPlayerStatus, setIsAudioActiveAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as React from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import { streamSpeech } from '@/sync/apiHappyVoice';
import { setPlaybackAudioMode } from '@/utils/microphonePermissions';
import { isVoiceSessionStarted } from '@/realtime/RealtimeSession';

export type MessageTtsState = 'idle' | 'loading' | 'playing';

// Single active playback across all messages (singleton across mounts).
let currentPlayingId: string | null = null;
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(fn => fn()); }

/** Swallow NativeSharedObjectNotFoundException when expo-audio released the player under us. */
function safePlayerCall(fn: () => void) {
    try { fn(); } catch { /* player released; nothing to do */ }
}

/**
 * Release the shared audio session once playback truly ends, so other apps'
 * audio can resume. Needed because the players are created with
 * keepAudioSessionActive (see below), which disables expo-audio's own
 * deactivation. iOS only: the deactivation being compensated is an
 * AVAudioSession behavior, and on Android setIsAudioActiveAsync(false) sets a
 * module-wide audioEnabled=false that makes every later play() a no-op (iOS
 * play() re-activates the session; Android play() never re-enables). Never
 * touch the session during a voice call — the RTC engine owns it there.
 */
function releaseAudioSession() {
    if (Platform.OS !== 'ios') return;
    if (isVoiceSessionStarted()) return;
    // Playback changed hands since the caller decided to release — keep the
    // session for the new owner. (The native call is async; a release landing
    // after another message's play() would pause it globally.)
    if (currentPlayingId !== null) return;
    setIsAudioActiveAsync(false).catch(() => { /* session busy; harmless */ });
}

/** Write one sentence's mp3 to a cache file and return its uri. */
function writeChunkFile(messageId: string, seq: number, audioBase64: string): string {
    const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const file = new File(Paths.cache, `tts-${safeId}-${seq}.mp3`);
    file.create({ overwrite: true, intermediates: true });
    file.write(audioBase64, { encoding: 'base64' });
    return file.uri;
}

/**
 * Native "read message aloud" with progressive playback. The gateway streams
 * sentence-by-sentence mp3 over SSE (read via expo/fetch, since RN's global fetch
 * has no streaming body); each sentence is written to a cache file and queued,
 * and expo-audio plays them in order, starting as soon as the first arrives.
 */
export function useMessageTts(messageId: string, text: string | null | undefined) {
    const [uri, setUri] = React.useState<string | null>(null);
    const [internalState, setInternalState] = React.useState<MessageTtsState>('idle');
    // keepAudioSessionActive: without it, expo-audio deactivates the shared iOS
    // audio session ~100ms after each sentence finishes unless another player is
    // already audibly playing — which races the next sentence's startup and kills
    // it silently, ending the advance chain mid-message. We release the session
    // ourselves via releaseAudioSession() when playback truly ends.
    const player = useAudioPlayer(uri || undefined, { keepAudioSessionActive: true });
    const status = useAudioPlayerStatus(player);
    const [, force] = React.useReducer((x: number) => x + 1, 0);

    const queueRef = React.useRef<string[]>([]);
    const idxRef = React.useRef(0);
    const doneRef = React.useRef(false);
    const stoppedRef = React.useRef(false);
    const startingRef = React.useRef(false);
    const pendingPlayRef = React.useRef(false);
    const abortRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        listeners.add(force);
        return () => { listeners.delete(force); };
    }, []);

    const reset = React.useCallback(() => {
        stoppedRef.current = true;
        abortRef.current?.abort();
        abortRef.current = null;
        safePlayerCall(() => player.pause());
        queueRef.current = [];
        idxRef.current = 0;
        doneRef.current = false;
        pendingPlayRef.current = false;
        setUri(null);
        setInternalState('idle');
    }, [player]);

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

    // Pause if another message took over playback.
    React.useEffect(() => {
        if (currentPlayingId !== null && currentPlayingId !== messageId && status.playing) {
            safePlayerCall(() => player.pause());
        }
    }, [messageId, status.playing, player]);

    // Start playback for a newly-set source. Deliberately NOT gated on
    // status.isLoaded: useAudioPlayerStatus keeps reporting the PREVIOUS
    // player's last event until the new player emits, so any status-based gate
    // either fires on stale data or (if gated on the new player's own event)
    // deadlocks when that event slips in before the subscription. play() before
    // the local file is ready is safe — the player latches the rate and starts
    // as soon as the item loads. The pendingPlayRef gate keeps this to one
    // play() per source; each source is a fresh player starting at 0.
    React.useEffect(() => {
        if (pendingPlayRef.current && uri && currentPlayingId === messageId) {
            pendingPlayRef.current = false;
            safePlayerCall(() => player.play());
            setInternalState('playing');
            notifyAll();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri, messageId]);

    // Advance to the next sentence when the current one finishes.
    React.useEffect(() => {
        if (!status.didJustFinish || currentPlayingId !== messageId) return;
        idxRef.current += 1;
        if (idxRef.current < queueRef.current.length) {
            pendingPlayRef.current = true;
            setUri(queueRef.current[idxRef.current]);
        } else if (doneRef.current) {
            currentPlayingId = null;
            setInternalState('idle');
            notifyAll();
            releaseAudioSession();
        } else {
            // caught up; waiting for the next sentence to arrive.
            setInternalState('loading');
            notifyAll();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.didJustFinish, messageId]);

    // Clear the global singleton on unmount if this message owned playback.
    React.useEffect(() => {
        return () => {
            if (currentPlayingId === messageId) {
                currentPlayingId = null;
                notifyAll();
                releaseAudioSession();
            }
        };
    }, [messageId]);

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
        doneRef.current = false;
        queueRef.current = [];
        idxRef.current = 0;
        pendingPlayRef.current = false;
        // Clear any source left from a previous run of this message: replaying
        // regenerates the same chunk file paths, and setUri with an identical
        // string would bail out of the re-render that starts playback.
        setUri(null);
        currentPlayingId = messageId;
        setInternalState('loading');
        notifyAll();

        // iOS routes playback to the earpiece by default (and the voice flow can
        // leave the session in record mode); force loudspeaker before playing.
        // Skip during an active voice call — switching off recording would cut the
        // call's mic, and the call already routes audio to the loudspeaker.
        if (!isVoiceSessionStarted()) {
            await setPlaybackAudioMode();
        }

        const ac = new AbortController();
        abortRef.current = ac;
        try {
            await streamSpeech(text, (chunk) => {
                if (stoppedRef.current) return;
                const fileUri = writeChunkFile(messageId, chunk.seq, chunk.audioBase64);
                queueRef.current.push(fileUri);
                // First sentence → start; or resume if playback had caught up and was waiting.
                if (queueRef.current.length === 1 || idxRef.current === queueRef.current.length - 1) {
                    pendingPlayRef.current = true;
                    setUri(queueRef.current[idxRef.current]);
                }
            }, ac.signal, expoFetch as unknown as typeof fetch);
            doneRef.current = true;
            // Stream ended and playback already drained the queue (or nothing
            // arrived at all) — finish here; the advance effect only runs on
            // didJustFinish, which won't fire again. If a sentence is still
            // playing, the advance effect finishes via doneRef instead.
            if (currentPlayingId === messageId && idxRef.current >= queueRef.current.length) {
                currentPlayingId = null;
                setInternalState('idle');
                notifyAll();
                releaseAudioSession();
            }
        } catch {
            doneRef.current = true;
            if (currentPlayingId === messageId && idxRef.current >= queueRef.current.length) {
                currentPlayingId = null;
                setInternalState('idle');
                notifyAll();
                releaseAudioSession();
            }
        } finally {
            startingRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, isMine, internalState, messageId, reset]);

    return { state, toggle };
}

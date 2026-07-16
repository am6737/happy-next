import * as React from 'react';
import { streamSpeech } from '@/sync/apiHappyVoice';

export type MessageTtsState = 'idle' | 'loading' | 'playing';

// Single active playback across all messages.
let currentPlayingId: string | null = null;
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach((fn) => fn()); }

interface Controller { stop: () => void; }

/**
 * Web "read message aloud" with progressive playback. The gateway streams
 * sentence-by-sentence audio (LLM-cleaned); we queue HTMLAudioElements and play
 * them in order, starting as soon as the first sentence arrives.
 */
export function useMessageTts(messageId: string, text: string | null | undefined) {
    const [state, setState] = React.useState<MessageTtsState>('idle');
    const ctrlRef = React.useRef<Controller | null>(null);
    const [, force] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        listeners.add(force);
        return () => { listeners.delete(force); };
    }, []);

    // Stop if another message took over playback.
    React.useEffect(() => {
        if (currentPlayingId !== null && currentPlayingId !== messageId && ctrlRef.current) {
            ctrlRef.current.stop();
            ctrlRef.current = null;
            setState('idle');
        }
    });

    // Reset when the message text changes (e.g. streamed/edited messages).
    React.useEffect(() => {
        ctrlRef.current?.stop();
        ctrlRef.current = null;
        setState('idle');
    }, [text]);

    // Clean up on unmount.
    React.useEffect(() => {
        return () => {
            ctrlRef.current?.stop();
            ctrlRef.current = null;
            if (currentPlayingId === messageId) { currentPlayingId = null; notifyAll(); }
        };
    }, [messageId]);

    const toggle = React.useCallback(async () => {
        if (!text) return;

        // Currently active for this message → stop.
        if (ctrlRef.current) {
            ctrlRef.current.stop();
            ctrlRef.current = null;
            if (currentPlayingId === messageId) { currentPlayingId = null; }
            setState('idle');
            notifyAll();
            return;
        }

        currentPlayingId = messageId;
        notifyAll();
        setState('loading');

        const audios: HTMLAudioElement[] = [];
        const ac = new AbortController();
        let idx = 0;
        let done = false;
        let stopped = false;
        let started = false;

        const finishIfDrained = () => {
            if (done && idx >= audios.length) {
                if (currentPlayingId === messageId) { currentPlayingId = null; }
                ctrlRef.current = null;
                setState('idle');
                notifyAll();
            }
        };

        const playNext = () => {
            if (stopped) return;
            if (idx >= audios.length) { finishIfDrained(); return; }
            const a = audios[idx];
            a.onended = () => { idx++; playNext(); };
            a.play().catch(() => {});
            if (!started) { started = true; setState('playing'); notifyAll(); }
        };

        ctrlRef.current = {
            stop: () => {
                stopped = true;
                ac.abort();
                for (const a of audios) { try { a.pause(); a.src = ''; } catch {} }
            },
        };

        try {
            await streamSpeech(text, (chunk) => {
                if (stopped) return;
                const a = new Audio(`data:${chunk.mimeType};base64,${chunk.audioBase64}`);
                audios.push(a);
                // Start the first chunk immediately; otherwise, if playback had
                // caught up and was waiting, this newly-arrived chunk resumes it.
                if (audios.length === 1 || idx === audios.length - 1) {
                    playNext();
                }
            }, ac.signal);
            done = true;
            finishIfDrained();
        } catch {
            done = true;
            if (!started) {
                ctrlRef.current = null;
                if (currentPlayingId === messageId) { currentPlayingId = null; }
                setState('idle');
                notifyAll();
            } else {
                // Mid-stream failure after playback started: if the queue has
                // already drained, no onended will fire again — finish now.
                finishIfDrained();
            }
        }
    }, [text, messageId]);

    const effectiveState: MessageTtsState = currentPlayingId === messageId ? state : 'idle';
    return { state: effectiveState, toggle };
}

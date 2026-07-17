import * as React from 'react';
import { prepareSpeechStream } from '@/sync/apiHappyVoice';

export type MessageTtsState = 'idle' | 'loading' | 'playing';

// Single active playback across all messages.
let currentPlayingId: string | null = null;
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach((fn) => fn()); }

interface Controller { stop: () => void; }

// ~1ms of silence, used to prime the element inside the tap gesture: Safari
// needs a play() that actually starts to mark the element user-activated.
const SILENT_WAV = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Web "read message aloud": a single HTMLAudioElement streams one
 * gateway-prepared chunked mp3 URL. (Per-sentence element chains got cut off
 * by Safari's autoplay policy after the first sentence.)
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

        let stopped = false;
        const ac = new AbortController();
        // Safari grants play() permission per element and only within user
        // activation (gone by the time prepare's round-trips resolve), so the
        // element is created and play()ed in the synchronous part of the tap;
        // the silent clip makes that play() actually succeed (src-less play()
        // just rejects) and the real src is swapped in after prepare.
        const audio = new Audio(SILENT_WAV);
        audio.play().catch(() => { /* priming is best-effort */ });

        const finish = () => {
            if (stopped) return;
            stopped = true;
            if (currentPlayingId === messageId) { currentPlayingId = null; }
            ctrlRef.current = null;
            setState('idle');
            notifyAll();
        };

        ctrlRef.current = {
            stop: () => {
                stopped = true;
                ac.abort();
                // Clearing src aborts the download; its error event is ignored via stopped.
                try { audio.pause(); audio.src = ''; } catch { /* already torn down */ }
            },
        };

        try {
            const { url } = await prepareSpeechStream(text, ac.signal);
            if (stopped) return;
            // 'playing' fires once audio is audibly out; stay loading until then.
            audio.onplaying = () => {
                if (!stopped && currentPlayingId === messageId) { setState('playing'); notifyAll(); }
            };
            // Server closes the stream at end of synthesis (natural end) and
            // destroys the socket on mid-stream failure (error); never surfaced.
            audio.onended = finish;
            audio.onerror = finish;
            audio.src = url;
            audio.play().catch(finish);
        } catch {
            // Prepare failed or was aborted — never surfaced; drop back to idle.
            finish();
        }
    }, [text, messageId]);

    const effectiveState: MessageTtsState = currentPlayingId === messageId ? state : 'idle';
    return { state: effectiveState, toggle };
}

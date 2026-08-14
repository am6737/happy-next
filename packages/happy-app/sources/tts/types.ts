// Shared contract between the queue store and the platform playback backends.
// Lives in its own file so ttsPlayerBackend.web.ts never has to import from the
// native file (a value import there would self-resolve under Metro's .web split).

export interface TtsQueueItem {
    messageId: string;
    sessionId: string;
    /** Text snapshot taken at tap time; later edits/streaming don't affect playback. */
    text: string;
}

export type TtsPhase = 'idle' | 'loading' | 'playing';

export interface TtsQueueSnapshot {
    current: TtsQueueItem | null;
    phase: TtsPhase;
    queue: readonly TtsQueueItem[];
}

export interface PlaybackCallbacks {
    /** Audio is audibly coming out (loading → playing). */
    onPlaying: () => void;
    /** Playback is over — natural end, failure or watchdog; the queue advances either way. */
    onDone: () => void;
}

export interface PlaybackHandle {
    /** Tear down this playback; must not fire callbacks afterwards. */
    stop: () => void;
}

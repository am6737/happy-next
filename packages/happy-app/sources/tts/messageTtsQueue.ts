import { onQueueIdle, primeForGesture, startPlayback } from './ttsPlayerBackend';
import type { PlaybackHandle, TtsPhase, TtsQueueItem, TtsQueueSnapshot } from './types';

export type { TtsPhase, TtsQueueItem, TtsQueueSnapshot } from './types';

// Global "read aloud" queue. Module-level on purpose: playback must outlive any
// screen — leaving the session or scrolling the message away no longer kills it.
// Invariant: current === null ⇔ phase === 'idle' ⇔ queue is empty (queue only
// grows while something is playing, and advance() drains it before going idle).

let current: TtsQueueItem | null = null;
let phase: TtsPhase = 'idle';
let queue: TtsQueueItem[] = [];
let handle: PlaybackHandle | null = null;
// Each start() bumps this; backend callbacks from an older run are ignored.
let generation = 0;

let snapshot: TtsQueueSnapshot = { current: null, phase: 'idle', queue: [] };
const listeners = new Set<() => void>();

function notify() {
    snapshot = { current, phase, queue: [...queue] };
    listeners.forEach((fn) => fn());
}

export function subscribeTtsQueue(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function getTtsQueueSnapshot(): TtsQueueSnapshot {
    return snapshot;
}

function start(item: TtsQueueItem) {
    const gen = ++generation;
    current = item;
    phase = 'loading';
    handle = startPlayback(item.text, {
        onPlaying: () => {
            if (gen !== generation) return;
            phase = 'playing';
            notify();
        },
        // Natural end and failure both just advance; failures were never
        // surfaced to the user in the pre-queue version either.
        onDone: () => {
            if (gen !== generation) return;
            advance();
        },
    });
}

function advance() {
    generation++;
    handle = null;
    const next = queue.shift();
    if (next) {
        start(next);
    } else {
        current = null;
        phase = 'idle';
        onQueueIdle();
    }
    notify();
}

function stopCurrentAndAdvance() {
    generation++; // invalidate first: stop() must not re-enter via onDone
    handle?.stop();
    handle = null;
    advance();
}

/** Floating-widget ✕: stop the current item and continue with the next. */
export function skipCurrentTts() {
    if (!current) return;
    stopCurrentAndAdvance();
}

/** Remove a queued (not yet playing) item. */
export function removeQueuedTts(messageId: string) {
    const before = queue.length;
    queue = queue.filter((q) => q.messageId !== messageId);
    if (queue.length !== before) notify();
}

/**
 * Per-message read-aloud button:
 * - this message is playing/loading → stop it, the queue continues
 * - already queued → remove from the queue
 * - something else is playing → append to the queue
 * - idle → play immediately
 */
export function toggleMessageTts(item: TtsQueueItem) {
    // Must run synchronously inside the tap gesture (Safari user activation).
    primeForGesture();
    if (current?.messageId === item.messageId) {
        stopCurrentAndAdvance();
        return;
    }
    if (queue.some((q) => q.messageId === item.messageId)) {
        removeQueuedTts(item.messageId);
        return;
    }
    if (current) {
        queue.push(item);
        notify();
        return;
    }
    start(item);
    notify();
}

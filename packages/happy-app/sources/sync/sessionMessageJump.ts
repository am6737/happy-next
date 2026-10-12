import type { MessageJumpTarget } from './typesMessage';

// A request that outlives this window was for a session the user never got to; drop it instead of
// jumping the next time that session happens to be opened.
const PENDING_JUMP_TTL_MS = 15_000;

const pending = new Map<string, { target: MessageJumpTarget; requestedAt: number }>();
const listeners = new Map<string, Set<() => void>>();

/** Asks the session view to scroll to `target` once it is showing `sessionId` (now, if it already is). */
export function requestSessionMessageJump(sessionId: string, target: MessageJumpTarget): void {
    pending.set(sessionId, { target, requestedAt: Date.now() });
    listeners.get(sessionId)?.forEach((listener) => listener());
}

/** Hands the pending target over exactly once. */
export function takeSessionMessageJump(sessionId: string): MessageJumpTarget | null {
    const entry = pending.get(sessionId);
    if (!entry) return null;
    pending.delete(sessionId);
    return Date.now() - entry.requestedAt <= PENDING_JUMP_TTL_MS ? entry.target : null;
}

export function subscribeSessionMessageJump(sessionId: string, listener: () => void): () => void {
    let set = listeners.get(sessionId);
    if (!set) {
        set = new Set();
        listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(sessionId);
    };
}

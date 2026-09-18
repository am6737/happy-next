import type { Session } from '@/sync/storageTypes';

const COMPLETION_ATTENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A completion the unread dot could still speak for, before anyone's dismissal is considered: a
 * finished task on a session that is still active, recent enough to be worth surfacing.
 */
export function hasLiveCompletion(session: Session, now: number = Date.now()): boolean {
    const taskCompleted = session.agentState?.taskCompleted;
    if (!taskCompleted || !session.active) {
        return false;
    }
    return now - taskCompleted <= COMPLETION_ATTENTION_MAX_AGE_MS;
}

export function hasUnreadCompletionSince(
    session: Session,
    localLastViewedAt: number,
    now: number = Date.now(),
): boolean {
    if (!hasLiveCompletion(session, now)) {
        return false;
    }

    const taskCompleted = session.agentState?.taskCompleted ?? 0;
    const syncedDismissedAt = session.metadata?.completionDismissedAt ?? 0;
    return taskCompleted > Math.max(localLastViewedAt, syncedDismissedAt);
}

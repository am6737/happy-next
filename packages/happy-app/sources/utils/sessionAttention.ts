import type { Session } from '@/sync/storageTypes';

const COMPLETION_ATTENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function hasUnreadCompletionSince(
    session: Session,
    localLastViewedAt: number,
    now: number = Date.now(),
): boolean {
    const taskCompleted = session.agentState?.taskCompleted;
    if (!taskCompleted || !session.active) {
        return false;
    }
    if (now - taskCompleted > COMPLETION_ATTENTION_MAX_AGE_MS) {
        return false;
    }

    const syncedDismissedAt = session.metadata?.completionDismissedAt ?? 0;
    return taskCompleted > Math.max(localLastViewedAt, syncedDismissedAt);
}

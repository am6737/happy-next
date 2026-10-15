import type { Session } from '@/sync/storageTypes';

type SortableSession = Pick<Session, 'id' | 'lastMessageAt' | 'createdAt'>;

// A session only moves above the one listed before it once its last message is this much newer,
// so two sessions replying at the same time keep their places instead of swapping on every message.
const OVERTAKE_MS = 10_000;

// Position of each session in the last computed order, shared by every list sorted by last message.
let displayRank = new Map<string, number>();

// When the conversation last moved. Session.updatedAt also advances on presence heartbeats and
// metadata/state writes, so it only serves as the sync cursor and must not be shown or sorted by.
export function sessionLastMessageAt(session: Pick<Session, 'lastMessageAt' | 'createdAt'>): number {
    return session.lastMessageAt ?? session.createdAt;
}

// Recomputes the shared order from every known session, starting from the previous order: sessions
// not seen before join by time, then each one climbs past those before it only while it is more
// than OVERTAKE_MS newer. Call whenever the session set or a session's last message time changes.
export function updateSessionDisplayOrder(sessions: SortableSession[]): void {
    const known = sessions
        .filter((session) => displayRank.has(session.id))
        .sort((a, b) => displayRank.get(a.id)! - displayRank.get(b.id)!);
    const added = sessions
        .filter((session) => !displayRank.has(session.id))
        .sort((a, b) => sessionLastMessageAt(b) - sessionLastMessageAt(a));
    const order = [...known, ...added];

    for (let i = 1; i < order.length; i++) {
        let j = i;
        while (j > 0 && sessionLastMessageAt(order[j]) - sessionLastMessageAt(order[j - 1]) > OVERTAKE_MS) {
            [order[j - 1], order[j]] = [order[j], order[j - 1]];
            j--;
        }
    }

    displayRank = new Map(order.map((session, index) => [session.id, index]));
}

export function compareSessionsByLastMessage(a: SortableSession, b: SortableSession): number {
    const rankA = displayRank.get(a.id);
    const rankB = displayRank.get(b.id);
    if (rankA !== undefined && rankB !== undefined) {
        return rankA - rankB;
    }
    return sessionLastMessageAt(b) - sessionLastMessageAt(a);
}

import type { Session } from '@/sync/storageTypes';

// When the conversation last moved. Session.updatedAt also advances on presence heartbeats and
// metadata/state writes, so it only serves as the sync cursor and must not be shown or sorted by.
export function sessionLastMessageAt(session: Pick<Session, 'lastMessageAt' | 'createdAt'>): number {
    return session.lastMessageAt ?? session.createdAt;
}

export function compareSessionsByLastMessage(
    a: Pick<Session, 'lastMessageAt' | 'createdAt'>,
    b: Pick<Session, 'lastMessageAt' | 'createdAt'>,
): number {
    return sessionLastMessageAt(b) - sessionLastMessageAt(a);
}

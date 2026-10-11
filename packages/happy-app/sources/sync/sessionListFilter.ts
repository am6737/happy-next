import type { Session } from './storageTypes';

// Hide controllers in list projections only; keep them in storage for direct navigation.
export function isSessionVisibleInList(session: Pick<Session, 'metadata'>): boolean {
    return session.metadata?.teammate?.role !== 'controller';
}

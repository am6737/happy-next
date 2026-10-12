import * as React from 'react';
import type { TurnHeaderStatus } from '@/components/messageTurnTiming';

/**
 * The turns the reader has watched run since the list opened, by the row that opens each.
 *
 * Only these may open in runs (see `turnFoldControl`): a turn that had already settled when the
 * reader came in is shown folded, newest or not, since what they come back to is the answers.
 *
 * What decides is how a turn is first seen, not how it is now. A turn first seen running was watched,
 * and stays so when it settles. A turn first seen settled was not, and stays so when the agent picks
 * it up again — that is a turn the reader came back to, still folded and saying on its line what it
 * is doing. So is a turn that ran and settled while the reader was elsewhere and arrives all at once:
 * it was never on screen open, so folded is where it starts. Either way a turn never changes between
 * the two, so this never folds anything the reader is looking at.
 *
 * Kept for as long as the list is mounted: leaving the chat and coming back starts again.
 */
export function useWatchedTurns(headerById: ReadonlyMap<string, TurnHeaderStatus>): ReadonlySet<string> {
    const seenRef = React.useRef(new Set<string>());
    const watchedRef = React.useRef<ReadonlySet<string>>(new Set());
    let watchedNow: string[] | null = null;
    for (const [headerId, status] of headerById) {
        if (seenRef.current.has(headerId)) continue;
        seenRef.current.add(headerId);
        if (status.state === 'running') (watchedNow ??= []).push(headerId);
    }
    // A new set only when one joins, so whatever is memoized on this keeps its value otherwise.
    if (watchedNow !== null) watchedRef.current = new Set([...watchedRef.current, ...watchedNow]);
    return watchedRef.current;
}

import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/sync/typesMessage';

/**
 * How long a settled turn waits, once the agent is busy again, before it counts as running. Long
 * enough to cover the reply to the send itself: the CLI reports it is thinking as soon as the prompt
 * reaches it, and that report can beat the send's own response — which is what puts the prompt in
 * the list — to this client.
 */
const RESUME_GRACE_MS = 1500;

/** The newest prompt in a newest-first list, which names the turn it opens. */
function newestPromptId(visibleMessages: readonly Message[]): string | null {
    for (const message of visibleMessages) {
        if (message.kind === 'user-text') return message.id;
    }
    return null;
}

/**
 * Whether the CLI stamped the newest turn's rows with the Claude turn they went out under
 * (`meta.turn`). Then a turn Claude starts on its own opens below the settled one rather than
 * resuming it (see `collectTurns`).
 */
function newestTurnStamped(visibleMessages: readonly Message[]): boolean {
    for (const message of visibleMessages) {
        if (message.kind === 'user-text') return false;
        if (message.meta?.turn !== undefined) return true;
    }
    return false;
}

/**
 * `turnInFlight` for `useTurnAnalysis`, with a settled turn held settled for a moment when the agent
 * turns busy again under it.
 *
 * Busy with no new prompt reads as the newest turn picking up again — its action bar comes off and
 * its header runs again. That is right for a turn the agent really resumes (a background task
 * reporting in), but busy also arrives ahead of a prompt the reader just sent, and then the previous
 * turn flickers for a frame before the prompt lands below it and starts a turn of its own. The send
 * marks itself busy together with its prompt (see `sendOrQueueMessage`); the CLI's report that it is
 * thinking has no such tie, and can come first. So the resume waits out `RESUME_GRACE_MS`: a prompt
 * landing within it is a new turn and runs at once, and a turn really resumed starts running when
 * the wait is over.
 *
 * A turn whose rows the CLI stamped with their Claude turn is held until a row lands instead. Claude
 * ending a turn and going busy again with no prompt is a turn of its own starting — a background task
 * reporting in — and it reports busy as it starts, well ahead of its first row: the model has yet to
 * write it. Running the settled turn meanwhile would take its action bar off, restart its header's
 * clock from its prompt and fold its answer away, all undone when that row opens the new turn below
 * it. Whatever lands decides: the new turn's row, a prompt, or a row of this very turn, which then
 * runs again.
 *
 * A turn that became busy in the same render as its prompt or row landed is never held: it is the
 * new turn, or the turn going on.
 */
export function useTurnInFlight(params: {
    /** `isSessionBusy`. */
    busy: boolean | undefined;
    /** The list's messages, newest first. */
    visibleMessages: readonly Message[];
}): boolean | undefined {
    const { busy, visibleMessages } = params;
    const promptId = newestPromptId(visibleMessages);
    const newestId = visibleMessages[0]?.id ?? null;
    const previousRef = useRef<{ busy: boolean | undefined; promptId: string | null; newestId: string | null } | null>(null);
    // `until` is null for a hold that waits on the next row (`newestId`) rather than the clock.
    const holdRef = useRef<{ promptId: string | null; newestId: string | null; until: number | null } | null>(null);
    const [, setExpired] = useState(0);

    const previous = previousRef.current;
    if (previous !== null && !previous.busy && busy && previous.promptId === promptId) {
        const until = newestTurnStamped(visibleMessages) ? null : Date.now() + RESUME_GRACE_MS;
        holdRef.current = { promptId, newestId: previous.newestId, until };
    }
    if (!busy) holdRef.current = null;
    previousRef.current = { busy, promptId, newestId };

    const hold = holdRef.current;
    const holding = hold !== null && hold.promptId === promptId
        && (hold.until === null ? hold.newestId === newestId : Date.now() < hold.until);

    // Wake up when the hold runs out, so a turn really resumed starts running then.
    const holdUntil = holding ? hold.until : null;
    useEffect(() => {
        if (holdUntil === null) return;
        const timer = setTimeout(() => setExpired((n) => n + 1), Math.max(0, holdUntil - Date.now()));
        return () => clearTimeout(timer);
    }, [holdUntil]);

    return holding ? false : busy;
}

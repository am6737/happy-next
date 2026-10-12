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
 * A turn that became busy in the same render as its prompt landed is never held: it is the new turn.
 */
export function useTurnInFlight(params: {
    /** `isSessionBusy`. */
    busy: boolean | undefined;
    /** The list's messages, newest first. */
    visibleMessages: readonly Message[];
}): boolean | undefined {
    const { busy, visibleMessages } = params;
    const promptId = newestPromptId(visibleMessages);
    const previousRef = useRef<{ busy: boolean | undefined; promptId: string | null } | null>(null);
    const holdRef = useRef<{ promptId: string | null; until: number } | null>(null);
    const [, setExpired] = useState(0);

    const previous = previousRef.current;
    if (previous !== null && !previous.busy && busy && previous.promptId === promptId) {
        holdRef.current = { promptId, until: Date.now() + RESUME_GRACE_MS };
    }
    if (!busy) holdRef.current = null;
    previousRef.current = { busy, promptId };

    const hold = holdRef.current;
    const holding = hold !== null && hold.promptId === promptId && Date.now() < hold.until;

    // Wake up when the hold runs out, so a turn really resumed starts running then.
    const holdUntil = holding ? hold.until : null;
    useEffect(() => {
        if (holdUntil === null) return;
        const timer = setTimeout(() => setExpired((n) => n + 1), Math.max(0, holdUntil - Date.now()));
        return () => clearTimeout(timer);
    }, [holdUntil]);

    return holding ? false : busy;
}

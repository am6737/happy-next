import * as React from 'react';
import { Message, UserTextMessage } from '@/sync/typesMessage';
import { foldMustKeepMessage } from './chatListVisibility';

/**
 * One assistant turn: everything between a user prompt and the next one.
 *
 * `startedAt` is the prompt's own timestamp — not the agent's first block.
 * Blocks land whole (the CLI forwards a finished assistant message, not tokens),
 * so a single-block reply would otherwise measure as ~0s: everything that made
 * the user wait happened between the prompt and that first block.
 */
type Turn = {
    /** The prompt that opened the turn; null when it started above the loaded window. */
    prompt: UserTextMessage | null;
    startedAt: number;
    /** Newest agent-text row of the turn: where the action bar goes. */
    lastTextId: string | null;
    /** Oldest agent row of the turn: where the turn's header goes. */
    headerId: string | null;
    /** Newest row of the turn — the best end estimate from timestamps alone. */
    lastRowAt: number;
    /** Every row of the agent's reply, oldest first — the order the walk below collects them in. */
    rows: Message[];
};

/**
 * What folding a turn's process hides, and what the folded line counts.
 *
 * The fold takes the process — the rows that led up to the agent's last step, that step included —
 * and what stands after that step is the conclusion: the agent stopped working and said what it came
 * to say, so it stays on screen whole. Two kinds of row inside the reach it may not swallow either:
 * the answer of a settled turn, which can be a row the agent wrote before its last step, and a row
 * the reader answers — a question card, or a request they have not decided yet. `hiddenIds` is that
 * set with the row under the line left out of it, because that row is not dropped: the line lives on
 * it.
 */
export type TurnProcess = {
    /**
     * Rows the list drops while this turn is folded, oldest first — never the row the line is drawn
     * on, which stays to carry it, and never a row the reader still has to answer.
     */
    hiddenIds: string[];
    /** Tool calls among the rows the fold hides, the row under the line included. */
    steps: number;
    /**
     * The newest row the fold hides, or null when it hides nothing. While the turn runs that is
     * whatever the agent is doing right now — the one thing a reader would want on the folded line,
     * since everything else about the turn is out of sight. It can be the row the line is drawn on,
     * which is all a turn has to show for itself when it opens with a step.
     */
    snapshotId: string | null;
    /**
     * The turn's answer — the one row the fold keeps besides the header, so a folded turn still says
     * what the agent concluded. Null while the turn runs, and for a turn that ends without a word of
     * its own.
     *
     * It can be the header row itself, when the turn's only text is the row it opens with. Such a row
     * carries the line and its own content at once.
     */
    answerId: string | null;
};

/** What the header above a turn's first row shows. */
export type TurnHeaderStatus =
    | { state: 'running'; startedAt: number }
    | { state: 'done'; startedAt: number; completedAt: number };

export type TurnAnalysis = {
    /** Rows that carry the action bar: the last text block of each settled turn. */
    completedIds: Set<string>;
    /** The same ids, to be latched as settled on the next pass. */
    stillCompleted: Set<string>;
    /** The turn still in flight, if any. */
    running: { lastTextId: string | null } | null;
    /** Header status per row id, for the rows that open a turn. */
    headerById: Map<string, TurnHeaderStatus>;
    /**
     * What each turn's process hides if folded, keyed by the header row it folds onto. A running
     * turn folds like any other — to its line alone, with the newest row's snapshot on it.
     */
    foldById: Map<string, TurnProcess>;
};

/**
 * A row's header props, flat so the list rows stay referentially comparable:
 * `undefined` for a row that opens no turn, and `completedAt: null` for one whose
 * turn is still running.
 */
export function turnHeaderProps(status: TurnHeaderStatus | undefined): {
    isTurnStart: boolean;
    turnStartedAt: number | undefined;
    turnCompletedAt: number | null | undefined;
} {
    if (status === undefined) {
        return { isTurnStart: false, turnStartedAt: undefined, turnCompletedAt: undefined };
    }
    return {
        isTurnStart: true,
        turnStartedAt: status.startedAt,
        turnCompletedAt: status.state === 'running' ? null : status.completedAt,
    };
}

/**
 * Group the list into turns, oldest first.
 *
 * A turn runs from its user prompt up to (not including) the next one; rows above
 * the oldest loaded prompt belong to a turn that started before what we have, and
 * are grouped as a single leading turn.
 */
function collectTurns(visibleMessages: Message[]): Turn[] {
    const turns: Turn[] = [];
    let current: Turn | null = null;

    for (let i = visibleMessages.length - 1; i >= 0; i--) {
        const msg = visibleMessages[i];
        if (current === null || msg.kind === 'user-text') {
            current = {
                prompt: msg.kind === 'user-text' ? msg : null,
                startedAt: msg.createdAt,
                lastTextId: null,
                headerId: null,
                lastRowAt: msg.createdAt,
                rows: [],
            };
            turns.push(current);
            if (msg.kind === 'user-text') continue;
        }
        current.rows.push(msg);
        // The turn's header sits above its first real agent row. Mode switches and
        // other notices don't open a turn's reply, so they don't take the slot.
        if (current.headerId === null && msg.kind !== 'agent-event') current.headerId = msg.id;
        if (msg.kind === 'agent-text' && !msg.isThinking) current.lastTextId = msg.id;
        current.lastRowAt = msg.createdAt;
    }

    return turns;
}

/**
 * The index of the row the fold's reach ends at: the agent's last step, or the turn's last row when
 * it never took one. A row the fold may not take is not a step either — the reach never ends on one,
 * so a turn that stops on an unanswered request keeps everything back to the step before it. A
 * request the reader has answered is a step like any other, so the reach ends on it and the fold
 * takes it.
 */
function lastStepIndex(rows: Message[]): number {
    for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        if (row.kind === 'tool-call' && !foldMustKeepMessage(row)) return index;
    }
    return rows.length - 1;
}

/**
 * What folding this turn would hide.
 *
 * The header row always stays: the folded line takes its place. A settled turn keeps its answer too,
 * because a folded turn should still say what the agent concluded — but a running one has no answer
 * yet, and what it does have is a step in progress. So a running turn folds to its line and nothing
 * else, and the line carries a snapshot of the newest row so the reader can still see what is being
 * done; when it settles, the turn's conclusion unfolds beneath the line.
 *
 * That conclusion is everything the agent wrote after its last step, not merely its final block. A
 * turn ends with a report and then a postscript often enough, and the report is the part worth
 * reading: taking it would leave the folded turn saying nothing about what it did. Only turns that
 * end on a step fall back on the answer alone — the last thing the agent said is then a row above
 * that step, and it is kept for the same reason.
 *
 * Rows nothing may hide are kept either way (`foldMustKeepMessage`): a question card and a tool call
 * whose permission request is still unanswered are both things the reader answers, so hiding one
 * would hide a prompt rather than working-out — a plan proposal is kept on that count alone, and so
 * folds away with the rest once the reader has decided it — and a notice the CLI wrote (a title
 * change, a mode switch, a usage limit) is the only trace of what it reports, so it stays too.
 */
function turnProcess(turn: Turn, settled: boolean): TurnProcess {
    const answerId = settled ? turn.lastTextId : null;
    // A turn still working has no conclusion to spare: the line stands for the whole of it.
    const reach = settled ? lastStepIndex(turn.rows) : turn.rows.length - 1;

    const hiddenIds: string[] = [];
    let steps = 0;
    let snapshotId: string | null = null;
    // Everything past the reach is the conclusion, and the walk simply never gets there.
    for (let index = 0; index <= reach; index++) {
        const row = turn.rows[index];
        // The rows the fold may not swallow are the answer — the fold exists to show it — and the rows
        // the reader answers, which are no more working-out than it is. So this walk is what the fold
        // hides, and the count and the snapshot are read straight off it with the row under the line
        // included: that row's content is gone too, and the line stands in its place.
        if (foldMustKeepMessage(row) || row.id === answerId) continue;
        if (row.kind === 'tool-call') steps++;
        // Collected oldest first, so the newest is the last one seen.
        snapshotId = row.id;
        // The row under the line is the one row of this set the list never drops: the line lives on it.
        if (row.id !== turn.headerId) hiddenIds.push(row.id);
    }
    return { hiddenIds, steps, snapshotId, answerId };
}

// The CLI stamps `taskCompleted` from its own clock; a stamp far ahead of ours
// is clock skew, not a duration.
const TASK_COMPLETED_FUTURE_SLACK_MS = 5000;

function taskCompletedAsTurnEnd(
    taskCompletedAt: number | null | undefined,
    startedAt: number,
    now: number,
): number | null {
    if (taskCompletedAt == null || taskCompletedAt < startedAt) return null;
    if (taskCompletedAt > now + TASK_COMPLETED_FUTURE_SLACK_MS) return null;
    return taskCompletedAt;
}

/**
 * Which rows carry the action bar, which carry a turn header, and how long each
 * turn took.
 *
 * The newest turn counts as settled once the agent stops working (`!turnInFlight`)
 * — unless it was already shown as settled (`previouslyCompleted`), a latch that
 * keeps the bar from flickering when `turnInFlight` briefly flips back on. Older
 * turns are bounded by a newer prompt and are always settled.
 *
 * A settled turn's end, best source first: the moment this client watched it
 * settle (`turnEnds`), the CLI's `taskCompleted` stamp (newest turn only — it
 * still answers for a reply that finished before this client was open), and
 * finally the turn's own last row, which is what makes every historical reply
 * show a duration rather than only the ones we happened to be watching.
 *
 * `now` is injectable for testing.
 */
export function analyzeTurns(params: {
    visibleMessages: Message[];
    /** The CLI's thinking heartbeat, or the optimistic marker set on send. */
    turnInFlight: boolean | undefined;
    previouslyCompleted: ReadonlySet<string>;
    /** Ends latched when this client saw a turn settle, keyed by last text row. */
    turnEnds: ReadonlyMap<string, number>;
    /** `session.agentState.taskCompleted`. */
    taskCompletedAt?: number | null;
    now?: number;
}): TurnAnalysis {
    const {
        visibleMessages,
        turnInFlight,
        previouslyCompleted,
        turnEnds,
        taskCompletedAt,
        now = Date.now(),
    } = params;

    const turns = collectTurns(visibleMessages);
    const completedIds = new Set<string>();
    const stillCompleted = new Set<string>();
    const headerById = new Map<string, TurnHeaderStatus>();
    const foldById = new Map<string, TurnProcess>();
    let running: { lastTextId: string | null } | null = null;

    for (let index = 0; index < turns.length; index++) {
        const turn = turns[index];
        const isNewest = index === turns.length - 1;
        const settled = !isNewest
            || !turnInFlight
            || (turn.lastTextId !== null && previouslyCompleted.has(turn.lastTextId));

        if (!settled) {
            running = { lastTextId: turn.lastTextId };
            if (turn.headerId !== null) {
                headerById.set(turn.headerId, { state: 'running', startedAt: turn.startedAt });
                foldById.set(turn.headerId, turnProcess(turn, false));
            }
            continue;
        }

        const completedAt = (turn.lastTextId !== null ? turnEnds.get(turn.lastTextId) : undefined)
            ?? (isNewest ? taskCompletedAsTurnEnd(taskCompletedAt, turn.startedAt, now) : null)
            ?? turn.lastRowAt;

        if (turn.headerId !== null) {
            headerById.set(turn.headerId, { state: 'done', startedAt: turn.startedAt, completedAt });
            foldById.set(turn.headerId, turnProcess(turn, true));
        }
        if (turn.lastTextId !== null) {
            completedIds.add(turn.lastTextId);
            stillCompleted.add(turn.lastTextId);
        }
    }

    return { completedIds, stillCompleted, running, headerById, foldById };
}

/**
 * The analysis for the current render, plus the latches it needs to carry across
 * renders: turn ends this client observed, and the settled rows to keep settled.
 *
 * Computed during render, with the refs updated alongside it: the list
 * virtualizes on measured row heights, so a header that appeared a commit late
 * would resize rows under a running model.
 */
export function useTurnAnalysis(params: {
    visibleMessages: Message[];
    /**
     * Whether the newest turn is still in flight: the CLI's thinking heartbeat,
     * or the marker set the moment a message is sent (which lands with the
     * message itself, so the reply's header appears with it).
     */
    turnInFlight: boolean | undefined;
    /** `session.agentState.taskCompleted`. */
    taskCompletedAt?: number | null;
}): Pick<TurnAnalysis, 'completedIds' | 'headerById' | 'foldById'> {
    const { visibleMessages, turnInFlight, taskCompletedAt } = params;
    const completedTurnsRef = React.useRef<Set<string>>(new Set());
    const turnEndsRef = React.useRef<Map<string, number>>(new Map());
    const runningRef = React.useRef<{ lastTextId: string | null } | null>(null);

    const analysis = React.useMemo(
        () => analyzeTurns({
            visibleMessages,
            turnInFlight,
            previouslyCompleted: completedTurnsRef.current,
            turnEnds: turnEndsRef.current,
            taskCompletedAt,
        }),
        [visibleMessages, turnInFlight, taskCompletedAt],
    );
    completedTurnsRef.current = analysis.stillCompleted;

    // A turn we were watching has settled: freeze the moment, so its duration is
    // the time it actually took rather than an estimate from its last row.
    const wasRunning = runningRef.current;
    const runningLastTextId = wasRunning?.lastTextId ?? null;
    if (runningLastTextId !== null
        && analysis.completedIds.has(runningLastTextId)
        && !turnEndsRef.current.has(runningLastTextId)) {
        turnEndsRef.current.set(runningLastTextId, Date.now());
    }
    runningRef.current = analysis.running;

    return React.useMemo(() => ({
        completedIds: analysis.completedIds,
        headerById: analysis.headerById,
        foldById: analysis.foldById,
    }), [analysis]);
}

import type { Message } from '@/sync/typesMessage';
import { extractOrchestratorSubmitRunId, extractOrchestratorSubmitTitle } from './tools/orchestratorRunId';

/** The delegated tasks a folded line hides that are still running. */
export type FoldDelegated = {
    /** What the newest of them was asked to do, or null when its call carried no title. */
    title: string | null;
    /** How many runs are going. */
    count: number;
};

/**
 * Which delegated tasks a folded line stands for are still running, or null when none is.
 *
 * A delegated task outlives the call that handed it off: `orchestrator_submit` completes at once and
 * the task goes on in the background, so a turn can be long settled while its work is still going. On
 * an open row that is the spinner the call's own row draws (see ToolView); a folded line takes those
 * rows away, so it has to say the same thing itself. The test is the same one the row uses — the call
 * is a submit whose run is among the session's active runs.
 *
 * `lineRow` is the row the line is drawn on, tried like any hidden one — it is the turn's first row,
 * so it comes first in order; it is null when the fold left that row's own content standing, and the
 * row shows its own spinner then.
 */
export function foldHidesRunningDelegatedTask(params: {
    /** Ids of the rows the fold hides, oldest first. */
    hiddenIds: readonly string[];
    lineRow: Message | null;
    messageById: ReadonlyMap<string, Message>;
    /** Runs of the session that still have a task going. */
    activeRunIds: readonly string[];
}): FoldDelegated | null {
    const { hiddenIds, lineRow, messageById, activeRunIds } = params;
    if (activeRunIds.length === 0) return null;
    const runIds = new Set<string>();
    let title: string | null = null;
    const visit = (row: Message | undefined) => {
        if (!row || row.kind !== 'tool-call') return;
        const runId = extractOrchestratorSubmitRunId(row.tool);
        if (runId === null || !activeRunIds.includes(runId)) return;
        runIds.add(runId);
        // The newest wins, but a call with no title does not blank one a later call lacks.
        title = extractOrchestratorSubmitTitle(row.tool) ?? title;
    };
    visit(lineRow ?? undefined);
    for (const id of hiddenIds) visit(messageById.get(id));
    return runIds.size === 0 ? null : { title, count: runIds.size };
}

/**
 * What a folded line's far end says of those tasks: undefined when none is running, null when there is
 * nothing to put into words (the line shows a spinner), otherwise the title — with how many more are
 * going when it is not the only one.
 */
export function delegatedLabel(
    delegated: FoldDelegated | null,
    /** Words for "this one and the others"; handed in so this stays free of the text module. */
    several: (title: string, count: number) => string,
): string | null | undefined {
    if (delegated === null) return undefined;
    if (delegated.title === null) return null;
    return delegated.count > 1 ? several(delegated.title, delegated.count) : delegated.title;
}

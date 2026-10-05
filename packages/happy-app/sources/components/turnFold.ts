import type { TurnProcess, TurnSegment } from './messageTurnTiming';

/** What the row that opens a turn needs to draw its folded line and toggle it. */
export type TurnFoldControl = {
    folded: boolean;
    /** Tool calls the folded line counts. */
    steps: number;
};

/** What the row that opens a run of steps needs to draw that run's line and toggle it. */
export type SegmentFoldControl = {
    folded: boolean;
    /** Tool calls the line counts. */
    steps: number;
    /** The turn has got no further than this run, so the line says what it is doing. */
    running: boolean;
    /** The rest of the run, which is what the line hides while it is folded. */
    hiddenIds: readonly string[];
    /**
     * The turn this run is in is folded as a whole. Its runs have no lines of their own then — the
     * turn's line stands for all of them — but the state each one was left in is kept.
     */
    turnFolded: boolean;
};

/** The setting's own name for "a run of steps starts folded". */
export type TurnFoldSetting = boolean;

/**
 * How a turn's process should render, or null when it should just render itself.
 *
 * A turn folds when its process has a step to stand for — a tool call — and the rule is the same
 * whether the turn is still running or long finished. While it runs the line is what the reader
 * watches, and its first step is already enough to be worth watching; once it is done the line is
 * what stands for the work, with the answer left below it.
 *
 * Nothing else folds. Words are the reply itself rather than the way to it, so a turn that has only
 * written is left as it was written, however much of it there is.
 *
 * Which of the two the setting decides depends on the turn's shape. A turn that is one run of steps
 * has one line, and the setting decides whether it starts folded. A turn the agent's words split into
 * several runs has a line for each run — those start as the setting says — and the turn's own line
 * above them is the whole turn at once, which starts open: the runs are what the setting folds, and
 * the line above them is for the reader who wants the lot gone. Either way a tap decides this line:
 * an explicit toggle outranks the default, so one the reader opened stays open.
 */
export function turnFoldControl(params: {
    process: TurnProcess;
    enabled: TurnFoldSetting;
    /** What the reader last chose for this turn, if they have touched it. */
    override: boolean | undefined;
}): TurnFoldControl | null {
    const { process, enabled, override } = params;
    // `steps` counts the tool calls whose row the line takes, the row it is drawn on included: a turn
    // that opens with a tool call gets its line from that first step, and one that has only written so
    // far has no step to fold.
    if (process.steps === 0) return null;
    const split = process.segments.length > 0;
    return { folded: override ?? (split ? false : enabled), steps: process.steps };
}

/** How one run of steps should render: the setting decides the default and a tap decides this run. */
export function segmentFoldControl(params: {
    segment: TurnSegment;
    enabled: TurnFoldSetting;
    /** What the reader last chose for this run, if they have touched it. */
    override: boolean | undefined;
    turnFolded: boolean;
}): SegmentFoldControl {
    const { segment, enabled, override, turnFolded } = params;
    return {
        folded: override ?? enabled,
        steps: segment.steps,
        running: segment.running,
        hiddenIds: segment.hiddenIds,
        turnFolded,
    };
}

export type TurnFoldResolution = {
    /** Rows the list drops, because the line that stands for them is folded. */
    hiddenIds: ReadonlySet<string>;
    /** The turn's line, on the row that opens a foldable turn, keyed by that row's id. */
    controlByHeaderId: ReadonlyMap<string, TurnFoldControl>;
    /** A run's line, on the run's first row, keyed by that row's id. */
    segmentControlByStartId: ReadonlyMap<string, SegmentFoldControl>;
};

/**
 * Every line's state and the rows they take between them.
 *
 * A folded turn takes all of its process, runs included, so its runs' own lines are not drawn and what
 * they would hide is already hidden. An open turn takes what its folded runs take.
 */
export function resolveTurnFolding(params: {
    foldById: ReadonlyMap<string, TurnProcess>;
    enabled: TurnFoldSetting;
    /** Taps on a turn's line, keyed by the row the line is drawn on. */
    turnOverrides: ReadonlyMap<string, boolean>;
    /** Taps on a run's line, keyed by the run's first row. */
    segmentOverrides: ReadonlyMap<string, boolean>;
}): TurnFoldResolution {
    const { foldById, enabled, turnOverrides, segmentOverrides } = params;
    const controlByHeaderId = new Map<string, TurnFoldControl>();
    const segmentControlByStartId = new Map<string, SegmentFoldControl>();
    const hiddenIds = new Set<string>();
    for (const [headerId, process] of foldById) {
        const control = turnFoldControl({ process, enabled, override: turnOverrides.get(headerId) });
        if (control === null) continue;
        controlByHeaderId.set(headerId, control);
        for (const segment of process.segments) {
            const segmentControl = segmentFoldControl({
                segment,
                enabled,
                override: segmentOverrides.get(segment.startId),
                turnFolded: control.folded,
            });
            segmentControlByStartId.set(segment.startId, segmentControl);
            if (!control.folded && segmentControl.folded) {
                for (const id of segment.hiddenIds) hiddenIds.add(id);
            }
        }
        if (control.folded) {
            for (const id of process.hiddenIds) hiddenIds.add(id);
        }
    }
    return { hiddenIds, controlByHeaderId, segmentControlByStartId };
}

/**
 * Whether the folded line leaves the row it is drawn on showing its own content.
 *
 * The line stands in for that row, and two kinds of row refuse to give way. A settled turn's answer,
 * because the fold exists to show what the agent concluded and the answer can be the very row the
 * line lands on. And a row the fold may not take (`foldMustKeepMessage`) — a landmark, a tool call
 * still waiting on a permission, or a notice the CLI wrote — which nothing may take wherever it sits
 * in the turn: the rail jumps to a landmark, a question and a permission request are both rows the
 * reader is the one who answers (a plan proposal being the second of the two: the card is the
 * request, and it is kept for as long as the request stands, no longer), and a notice is the only
 * trace of what it reports.
 *
 * The rows a fold drops are filtered the same way, but that filter cannot cover this case: a row the
 * fold may not take can open a turn, and the row that opens a turn is the row the line lands on. A
 * row the line lands on is never dropped — it renders, with the line in place of its content. So the
 * exception has to be made here too, and this is where it is made.
 */
export function foldedLineKeepsRow(params: {
    /** Whether the turn is folded at all; an unfolded row renders as itself and keeps nothing back. */
    folded: boolean;
    /** Whether this row is the turn's answer. */
    answer: boolean;
    /** Whether the fold may not take this row at all — see `foldMustKeepMessage`. */
    mustKeep: boolean;
}): boolean {
    if (!params.folded) return false;
    return params.answer || params.mustKeep;
}

import type { TurnProcess } from './messageTurnTiming';

/** What the row that opens a turn needs to draw its folded line and toggle it. */
export type TurnFoldControl = {
    folded: boolean;
    /** Tool calls the folded line counts. */
    steps: number;
};

/** The setting's own name for "a turn's process starts folded". */
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
 * The setting decides the default and a tap decides this turn: an explicit toggle outranks the
 * setting, so a turn the reader opened stays open however the setting reads.
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
    return { folded: override ?? enabled, steps: process.steps };
}

/**
 * Whether the folded line leaves the row it is drawn on showing its own content.
 *
 * The line stands in for that row, and two kinds of row refuse to give way. A settled turn's answer,
 * because the fold exists to show what the agent concluded and the answer can be the very row the
 * line lands on. And a landmark — a question card, an inline HTML preview, a plan proposal — which
 * no fold may take wherever it sits in the turn: the rail jumps to it, and a question and a plan
 * proposal are rows the reader is the one who answers.
 *
 * The rows a fold drops are filtered the same way (see `isMinimapLandmarkRow`), but that filter
 * cannot cover this case: a landmark that opens a turn is the row the line lands on, and a row the
 * line lands on is never dropped — it renders, with the line in place of its content. So the
 * exception has to be made here too, and this is where it is made.
 */
export function foldedLineKeepsRow(params: {
    /** Whether the turn is folded at all; an unfolded row renders as itself and keeps nothing back. */
    folded: boolean;
    /** Whether this row is the turn's answer. */
    answer: boolean;
    /** Whether this row is a landmark the conversation rail marks. */
    landmark: boolean;
}): boolean {
    if (!params.folded) return false;
    return params.answer || params.landmark;
}

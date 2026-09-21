import type { TurnProcess } from './messageTurnTiming';

/**
 * How much of a settled turn has to be hidden before folding it is worth having: fewer rows than
 * this and the process is one or two lines already, so folding it would cost a tap and save nothing.
 * Same shape of rule as the too-long threshold in messageCollapse.ts.
 *
 * It is a rule about reading a finished turn, so it does not apply to one still running — see
 * turnFoldControl.
 */
export const TURN_FOLD_MIN_HIDDEN_ROWS = 3;

/** What the row that opens a turn needs to draw its folded line and toggle it. */
export type TurnFoldControl = {
    folded: boolean;
    /** Tool calls the folded line counts. */
    steps: number;
};

/** The setting's own name for "a finished turn's process starts folded". */
export type TurnFoldSetting = boolean;

/**
 * How a turn's process should render, or null when it should just render itself.
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
    // A running turn folds from its first hidden row. The reader is watching this one work, and a
    // process that shows itself for a couple of rows and is then taken away is the list moving under
    // them — the threshold above is about how much a finished turn is worth a tap to open.
    const worth = process.running
        ? process.hiddenIds.length > 0
        : process.hiddenIds.length >= TURN_FOLD_MIN_HIDDEN_ROWS;
    if (!worth) return null;
    return { folded: override ?? enabled, steps: process.steps };
}

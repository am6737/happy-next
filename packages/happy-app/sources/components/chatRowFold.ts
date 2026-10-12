import type { Message, ToolCall } from '@/sync/typesMessage';
import { foldMustKeepMessage } from './chatListVisibility';
import { delegatedLabel, foldHidesRunningDelegatedTask } from './foldDelegated';
import type { TurnHeaderStatus, TurnProcess } from './messageTurnTiming';
import { newestRowSnapshot, type ToolHeadline } from './rowSnapshot';
import { foldedLineKeepsRow, type TurnFoldResolution } from './turnFold';

/**
 * What one row of the native list needs to draw the fold lines it carries, as plain data — a turn's
 * line on the row that opens a foldable turn, a run's line on the row that opens a run of steps, or
 * both. The same values `ChatList.web.tsx` hands `MessageView` from its render loop, less what only
 * its animation needs; see `MessageView`'s props for what each one means.
 */
export type ChatRowFold = {
    foldFolded: boolean | undefined;
    foldKeepsRow: boolean;
    foldDivides: boolean;
    foldSteps: number | undefined;
    foldSnapshot: string | undefined;
    foldDelegated: string | null | undefined;
    segmentFolded: boolean | undefined;
    segmentSteps: number | undefined;
    segmentTool: ToolCall | undefined;
    segmentSnapshot: string | undefined;
    segmentDelegated: string | null | undefined;
    segmentRunning: boolean;
};

/**
 * The fold lines of the conversation, keyed by the row each is drawn on. Only rows that carry a line
 * are in the map, so it stays as small as the number of turns. Rows the folding hides are not drawn
 * at all and are left to the caller to drop (`TurnFoldResolution.hiddenIds`).
 *
 * Keep in sync with the render loop in `ChatList.web.tsx`, which works the same values out per row.
 */
export function buildChatRowFolds(params: {
    folding: TurnFoldResolution;
    foldById: ReadonlyMap<string, TurnProcess>;
    headerById: ReadonlyMap<string, TurnHeaderStatus>;
    /** Every message of the session by id, for the snapshot and the run's icon. */
    messageById: ReadonlyMap<string, Message>;
    /** Runs of this session with a delegated task still going. */
    activeRunIds: readonly string[];
    headlineOf: (tool: ToolCall) => ToolHeadline | null;
    /** Words for "this task and n others". */
    delegatedMore: (title: string, count: number) => string;
}): Map<string, ChatRowFold> {
    const { folding, foldById, headerById, messageById, activeRunIds, headlineOf, delegatedMore } = params;
    const ids = new Set<string>([...folding.controlByHeaderId.keys(), ...folding.segmentControlByStartId.keys()]);
    const folds = new Map<string, ChatRowFold>();
    for (const id of ids) {
        const item = messageById.get(id);
        if (!item) continue;
        const fold = folding.controlByHeaderId.get(id);
        const process = foldById.get(id);
        // The fold keeps a settled turn's answer and never a row the reader answers; either can be the
        // row the line sits on, which then shows its own content under the line.
        const foldKeepsRow = foldedLineKeepsRow({
            folded: fold?.folded === true,
            answer: process?.answerId === id || process?.headerConcludes === true,
            mustKeep: foldMustKeepMessage(item),
        });
        // A running turn's folded line says what the turn is doing; a settled one shows its answer.
        const foldSnapshot = fold?.folded && headerById.get(id)?.state === 'running'
            ? newestRowSnapshot({ hiddenIds: process?.hiddenIds ?? [], lineRow: foldKeepsRow ? null : item, messageById, headlineOf })
            : undefined;
        const foldDelegated = fold?.folded === true && foldSnapshot === undefined
            ? delegatedLabel(foldHidesRunningDelegatedTask({
                hiddenIds: process?.hiddenIds ?? [],
                lineRow: foldKeepsRow ? null : item,
                messageById,
                activeRunIds,
            }), delegatedMore)
            : undefined;
        // A turn folded as a whole draws no lines for its runs: its own line stands for all of them.
        const segment = folding.segmentControlByStartId.get(id);
        const segmentShown = segment !== undefined && !segment.turnFolded;
        if (!fold && !segmentShown) continue;
        const segmentSnapshot = segmentShown && segment.folded && segment.running
            ? newestRowSnapshot({ hiddenIds: segment.hiddenIds, lineRow: item, messageById, headlineOf })
            : undefined;
        const segmentDelegated = segmentShown && segment.folded && segmentSnapshot === undefined
            ? delegatedLabel(foldHidesRunningDelegatedTask({ hiddenIds: segment.hiddenIds, lineRow: item, messageById, activeRunIds }), delegatedMore)
            : undefined;
        const firstStep = segment ? messageById.get(segment.firstStepId) : undefined;
        folds.set(id, {
            foldFolded: fold?.folded,
            foldKeepsRow,
            // A folded turn with no answer to show has nothing under its line to divide.
            foldDivides: !(fold?.folded === true && process?.answerId == null),
            foldSteps: fold?.steps,
            foldSnapshot,
            foldDelegated,
            segmentFolded: segmentShown ? segment.folded : undefined,
            segmentSteps: segment?.steps,
            segmentTool: firstStep?.kind === 'tool-call' ? firstStep.tool : undefined,
            segmentSnapshot,
            segmentDelegated,
            segmentRunning: segment?.running === true,
        });
    }
    return folds;
}

export function chatRowFoldsAreEqual(a: ChatRowFold | undefined, b: ChatRowFold | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.foldFolded === b.foldFolded
        && a.foldKeepsRow === b.foldKeepsRow
        && a.foldDivides === b.foldDivides
        && a.foldSteps === b.foldSteps
        && a.foldSnapshot === b.foldSnapshot
        && a.foldDelegated === b.foldDelegated
        && a.segmentFolded === b.segmentFolded
        && a.segmentSteps === b.segmentSteps
        && a.segmentTool === b.segmentTool
        && a.segmentSnapshot === b.segmentSnapshot
        && a.segmentDelegated === b.segmentDelegated
        && a.segmentRunning === b.segmentRunning;
}

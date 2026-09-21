import { describe, expect, it } from 'vitest';
import { TURN_FOLD_MIN_HIDDEN_ROWS, turnFoldControl } from './turnFold';
import type { TurnProcess } from './messageTurnTiming';

function process(hidden: number, steps = hidden, running = false): TurnProcess {
    const hiddenIds = Array.from({ length: hidden }, (_, i) => `row-${i}`);
    return {
        hiddenIds,
        steps,
        snapshotId: hiddenIds.length > 0 ? hiddenIds[hiddenIds.length - 1] : null,
        answerId: null,
        running,
    };
}

describe('turnFoldControl', () => {
    it('folds a long enough process when the setting asks for it', () => {
        expect(turnFoldControl({ process: process(7), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: 7 });
    });

    it('leaves the process inline when the setting is off', () => {
        expect(turnFoldControl({ process: process(7), enabled: false, override: undefined }))
            .toEqual({ folded: false, steps: 7 });
    });

    it('leaves a short process alone however the setting reads', () => {
        const short = process(TURN_FOLD_MIN_HIDDEN_ROWS - 1);
        expect(turnFoldControl({ process: short, enabled: true, override: undefined })).toBeNull();
        expect(turnFoldControl({ process: short, enabled: false, override: undefined })).toBeNull();
    });

    it('folds a process at the threshold', () => {
        expect(turnFoldControl({ process: process(TURN_FOLD_MIN_HIDDEN_ROWS), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: TURN_FOLD_MIN_HIDDEN_ROWS });
    });

    it('folds a running turn from its first hidden row', () => {
        // Nothing is worth waiting for while the turn is still going: the line is what the reader
        // watches, and a row that appears and is then taken away is the list moving under them.
        expect(turnFoldControl({ process: process(1, 1, true), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: 1 });
        // Still nothing to fold when the process has hidden nothing at all.
        expect(turnFoldControl({ process: process(0, 0, true), enabled: true, override: undefined })).toBeNull();
    });

    it('folds nothing when the turn hid nothing', () => {
        expect(turnFoldControl({ process: process(0, 0), enabled: true, override: undefined })).toBeNull();
    });

    it('lets a tap outrank the setting, both ways', () => {
        expect(turnFoldControl({ process: process(7), enabled: true, override: false }))
            .toEqual({ folded: false, steps: 7 });
        expect(turnFoldControl({ process: process(7), enabled: false, override: true }))
            .toEqual({ folded: true, steps: 7 });
    });

    it('counts the tool calls separately from the rows hidden', () => {
        // A turn of prose and thinking with two tool calls in it: five rows go, two are steps.
        expect(turnFoldControl({ process: process(5, 2), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: 2 });
    });
});

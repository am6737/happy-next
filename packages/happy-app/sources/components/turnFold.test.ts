import { describe, expect, it } from 'vitest';
import { foldedLineKeepsRow, turnFoldControl } from './turnFold';
import type { TurnProcess } from './messageTurnTiming';

/** A process that hides `hidden` rows, `steps` of them tool calls. */
function process(hidden: number, steps = hidden): TurnProcess {
    const hiddenIds = Array.from({ length: hidden }, (_, i) => `row-${i}`);
    return {
        hiddenIds,
        steps,
        snapshotId: hiddenIds.length > 0 ? hiddenIds[hiddenIds.length - 1] : null,
        answerId: null,
    };
}

describe('turnFoldControl', () => {
    it('folds a turn with a step when the setting asks for it', () => {
        expect(turnFoldControl({ process: process(7), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: 7 });
    });

    it('folds from the very first step, before there is any row to drop', () => {
        // The line is drawn on the turn's first tool call, so folding has no row to take out of the
        // list yet: the line standing in for that row is the whole of what it does — which is exactly
        // what makes a turn fold from its first step instead of showing a full tool row until a second
        // one arrives.
        expect(turnFoldControl({ process: process(0, 1), enabled: true, override: undefined }))
            .toEqual({ folded: true, steps: 1 });
    });

    it('leaves the process inline when the setting is off', () => {
        expect(turnFoldControl({ process: process(7), enabled: false, override: undefined }))
            .toEqual({ folded: false, steps: 7 });
    });

    it('leaves a turn that has only written alone however the setting reads', () => {
        // No step to stand for. Words are the reply itself rather than the way to it: a line over them
        // would hide what the reader is reading and say nothing in its place.
        const writing = process(4, 0);
        expect(turnFoldControl({ process: writing, enabled: true, override: undefined })).toBeNull();
        expect(turnFoldControl({ process: writing, enabled: false, override: undefined })).toBeNull();
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

describe('foldedLineKeepsRow', () => {
    const plain = { folded: true, answer: false, mustKeep: false };

    it('lets the line take the place of a row that is only working-out', () => {
        expect(foldedLineKeepsRow(plain)).toBe(false);
    });

    it('keeps the answer of a settled turn, which can be the row the line lands on', () => {
        expect(foldedLineKeepsRow({ ...plain, answer: true })).toBe(true);
    });

    it('keeps a row the fold may not take, which it may not hide wherever it sits', () => {
        // A question card that opens a turn is the row the line lands on, so this is the only thing
        // standing between the reader and a question the fold would otherwise take away. A landmark
        // and a step still waiting on a permission both arrive here as `mustKeep`.
        expect(foldedLineKeepsRow({ ...plain, mustKeep: true })).toBe(true);
    });

    it('keeps nothing back when the turn is not folded', () => {
        expect(foldedLineKeepsRow({ folded: false, answer: true, mustKeep: true })).toBe(false);
    });
});

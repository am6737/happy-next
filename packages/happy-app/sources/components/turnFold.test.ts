import { describe, expect, it } from 'vitest';
import { foldedLineKeepsRow, resolveTurnFolding, segmentFoldControl, turnFoldControl } from './turnFold';
import type { TurnProcess, TurnSegment } from './messageTurnTiming';

/** A process that hides `hidden` rows, `steps` of them tool calls. */
function process(hidden: number, steps = hidden, segments: TurnSegment[] = []): TurnProcess {
    const hiddenIds = Array.from({ length: hidden }, (_, i) => `row-${i}`);
    return {
        hiddenIds,
        steps,
        snapshotId: hiddenIds.length > 0 ? hiddenIds[hiddenIds.length - 1] : null,
        answerId: null,
        segments,
    };
}

/** A run of `hidden + 1` steps, drawn on `startId`. */
function segment(startId: string, hidden: string[] = [], running = false): TurnSegment {
    return {
        startId,
        hiddenIds: hidden,
        steps: hidden.length + 1,
        snapshotId: hidden.length > 0 ? hidden[hidden.length - 1] : startId,
        running,
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

describe('a turn split into runs of steps', () => {
    const split = process(4, 4, [segment('a', ['b']), segment('c', ['d'])]);

    it('starts open however the setting reads, leaving the folding to its runs', () => {
        expect(turnFoldControl({ process: split, enabled: true, override: undefined }))
            .toEqual({ folded: false, steps: 4 });
        expect(turnFoldControl({ process: split, enabled: false, override: undefined }))
            .toEqual({ folded: false, steps: 4 });
    });

    it('still lets a tap fold the whole turn', () => {
        expect(turnFoldControl({ process: split, enabled: true, override: true }))
            .toEqual({ folded: true, steps: 4 });
    });
});

describe('segmentFoldControl', () => {
    const run = segment('a', ['b'], true);

    it('starts as the setting says', () => {
        expect(segmentFoldControl({ segment: run, enabled: true, override: undefined, turnFolded: false }))
            .toEqual({ folded: true, steps: 2, running: true, hiddenIds: ['b'], turnFolded: false });
        expect(segmentFoldControl({ segment: run, enabled: false, override: undefined, turnFolded: false }).folded)
            .toBe(false);
    });

    it('lets a tap outrank the setting, both ways', () => {
        expect(segmentFoldControl({ segment: run, enabled: true, override: false, turnFolded: false }).folded).toBe(false);
        expect(segmentFoldControl({ segment: run, enabled: false, override: true, turnFolded: false }).folded).toBe(true);
    });
});

describe('resolveTurnFolding', () => {
    // One turn on `h`: a run on `h` itself and another on `c`, with words between them.
    const turn = process(5, 4, [segment('h', ['b']), segment('c', ['d'])]);
    const resolve = (
        overrides: { turn?: [string, boolean][]; segment?: [string, boolean][]; enabled?: boolean } = {},
    ) => resolveTurnFolding({
        foldById: new Map([['h', turn]]),
        enabled: overrides.enabled ?? true,
        turnOverrides: new Map(overrides.turn ?? []),
        segmentOverrides: new Map(overrides.segment ?? []),
    });

    it('hides what the folded runs hide, leaving the open turn and the words between them', () => {
        const folding = resolve();
        expect([...folding.hiddenIds].sort()).toEqual(['b', 'd']);
        expect(folding.controlByHeaderId.get('h')).toEqual({ folded: false, steps: 4 });
        expect([...folding.segmentControlByStartId.keys()]).toEqual(['h', 'c']);
    });

    it('hides the whole process once the turn is folded, whatever the runs say', () => {
        const folding = resolve({ turn: [['h', true]], segment: [['h', false], ['c', false]] });
        expect([...folding.hiddenIds].sort()).toEqual(turn.hiddenIds.slice().sort());
    });

    it('keeps a run open that the reader opened, and remembers it under a folded turn', () => {
        const open = resolve({ segment: [['c', false]] });
        expect([...open.hiddenIds]).toEqual(['b']);
        const folded = resolve({ turn: [['h', true]], segment: [['c', false]] });
        expect(folded.segmentControlByStartId.get('c')?.folded).toBe(false);
    });

    it('says on each run whether the turn above it is folded', () => {
        expect(resolve().segmentControlByStartId.get('c')?.turnFolded).toBe(false);
        expect(resolve({ turn: [['h', true]] }).segmentControlByStartId.get('c')?.turnFolded).toBe(true);
    });

    it('hides nothing of a run when the setting leaves runs open', () => {
        expect(resolve({ enabled: false }).hiddenIds.size).toBe(0);
    });

    it('folds a turn that is one run by the setting, with no runs of its own', () => {
        const single = process(2, 3);
        const folding = resolveTurnFolding({
            foldById: new Map([['h', single]]),
            enabled: true,
            turnOverrides: new Map(),
            segmentOverrides: new Map(),
        });
        expect(folding.controlByHeaderId.get('h')?.folded).toBe(true);
        expect(folding.segmentControlByStartId.size).toBe(0);
        expect([...folding.hiddenIds]).toEqual(single.hiddenIds);
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

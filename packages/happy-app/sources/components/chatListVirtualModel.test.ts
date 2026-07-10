import { describe, expect, it } from 'vitest';
import {
    buildLayoutModel,
    compensatedDistanceFromBottom,
    computeVisibleRange,
    distanceToAlignEntryTop,
    distanceToCenterEntry,
    nextViewportState,
    pickCompensationAnchor,
    rangeAroundAnchor,
    rangeContains,
    sameKeys,
    type ViewportState,
} from './chatListVirtualModel';

const KEYS = ['A', 'B', 'C', 'D', 'E']; // oldest → newest

function uniformLayout(measured: Record<string, number> = {}) {
    return buildLayoutModel({ keys: KEYS, measuredHeightsByKey: measured, estimateHeightPx: 100 });
}

describe('buildLayoutModel', () => {
    it('computes offsets from estimates', () => {
        const layout = uniformLayout();
        expect(layout.totalHeightPx).toBe(500);
        expect(layout.topOffsetsPx).toEqual([0, 100, 200, 300, 400]);
        expect(layout.bottomOffsetsPx).toEqual([400, 300, 200, 100, 0]);
        expect(layout.indexByKey.get('C')).toBe(2);
    });

    it('prefers measured heights over the estimate', () => {
        const layout = uniformLayout({ D: 150 });
        expect(layout.totalHeightPx).toBe(550);
        expect(layout.heightsPx).toEqual([100, 100, 100, 150, 100]);
        expect(layout.bottomOffsetsPx).toEqual([450, 350, 250, 100, 0]);
    });

    it('handles an empty entry set', () => {
        const layout = buildLayoutModel({ keys: [], measuredHeightsByKey: {}, estimateHeightPx: 100 });
        expect(layout.totalHeightPx).toBe(0);
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 0, viewportHeightPx: 100, overscanCount: 5 }))
            .toEqual({ startIndex: 0, endIndex: 0 });
    });
});

describe('computeVisibleRange', () => {
    it('returns the newest entries at the bottom', () => {
        const layout = uniformLayout();
        // Viewport bottom 150px: E fully, D partially.
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 0, viewportHeightPx: 150, overscanCount: 0 }))
            .toEqual({ startIndex: 3, endIndex: 5 });
    });

    it('returns the intersecting middle entries', () => {
        const layout = uniformLayout();
        // Viewport [175, 325] from the bottom: B (300–400), C (200–300), D (100–200).
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 175, viewportHeightPx: 150, overscanCount: 0 }))
            .toEqual({ startIndex: 1, endIndex: 4 });
    });

    it('pads with overscan and clamps to the entry set', () => {
        const layout = uniformLayout();
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 175, viewportHeightPx: 150, overscanCount: 1 }))
            .toEqual({ startIndex: 0, endIndex: 5 });
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 0, viewportHeightPx: 150, overscanCount: 99 }))
            .toEqual({ startIndex: 0, endIndex: 5 });
    });

    it('clamps a distance beyond the content to the topmost entry', () => {
        const layout = uniformLayout();
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 1000, viewportHeightPx: 150, overscanCount: 0 }))
            .toEqual({ startIndex: 0, endIndex: 1 });
    });
});

describe('rangeAroundAnchor', () => {
    it('teleports the window to the anchor preserving size', () => {
        const layout = uniformLayout();
        expect(rangeAroundAnchor({ layout, anchorKey: 'B', previousRange: { startIndex: 3, endIndex: 5 } }))
            .toEqual({ startIndex: 1, endIndex: 3 });
    });

    it('clamps at the end of the entry set', () => {
        const layout = uniformLayout();
        expect(rangeAroundAnchor({ layout, anchorKey: 'E', previousRange: { startIndex: 0, endIndex: 3 } }))
            .toEqual({ startIndex: 4, endIndex: 5 });
    });

    it('returns null for a removed anchor', () => {
        const layout = uniformLayout();
        expect(rangeAroundAnchor({ layout, anchorKey: 'Z', previousRange: { startIndex: 0, endIndex: 2 } }))
            .toBeNull();
    });
});

describe('compensatedDistanceFromBottom', () => {
    it('keeps the anchor still when an entry below it grows', () => {
        const previousLayout = uniformLayout({ C: 100, D: 100 });
        const nextLayout = uniformLayout({ C: 100, D: 150 });
        // D grew by 50 below the viewport; the distance must grow by 50 too.
        expect(compensatedDistanceFromBottom({
            anchorKey: 'C',
            distanceFromBottomPx: 220,
            previousLayout,
            nextLayout,
        })).toBe(270);
    });

    it('is a no-op when an entry above the anchor changes', () => {
        const previousLayout = uniformLayout();
        const nextLayout = uniformLayout({ A: 300 });
        expect(compensatedDistanceFromBottom({
            anchorKey: 'C',
            distanceFromBottomPx: 220,
            previousLayout,
            nextLayout,
        })).toBe(220);
    });

    it('compensates an append below the anchor (new entry at the bottom)', () => {
        const previousLayout = uniformLayout();
        const nextLayout = buildLayoutModel({
            keys: [...KEYS, 'F'],
            measuredHeightsByKey: {},
            estimateHeightPx: 100,
        });
        expect(compensatedDistanceFromBottom({
            anchorKey: 'C',
            distanceFromBottomPx: 220,
            previousLayout,
            nextLayout,
        })).toBe(320);
    });

    it('is a no-op for a prepend (older page) — bottom-anchored coordinates', () => {
        const previousLayout = uniformLayout();
        const nextLayout = buildLayoutModel({
            keys: ['P1', 'P2', ...KEYS],
            measuredHeightsByKey: {},
            estimateHeightPx: 100,
        });
        expect(compensatedDistanceFromBottom({
            anchorKey: 'C',
            distanceFromBottomPx: 220,
            previousLayout,
            nextLayout,
        })).toBe(220);
    });

    it('returns null when the anchor is missing from either layout', () => {
        const layout = uniformLayout();
        expect(compensatedDistanceFromBottom({
            anchorKey: 'Z',
            distanceFromBottomPx: 100,
            previousLayout: layout,
            nextLayout: layout,
        })).toBeNull();
    });
});

describe('pickCompensationAnchor', () => {
    it('picks the topmost MEASURED entry in the strict viewport', () => {
        const previousLayout = uniformLayout({ C: 100, D: 100 });
        const nextLayout = previousLayout;
        // Viewport [175, 325]: B (unmeasured, skipped), C (measured) wins.
        expect(pickCompensationAnchor({
            previousLayout,
            nextLayout,
            distanceFromBottomPx: 175,
            viewportHeightPx: 150,
            measuredHeightsByKey: { C: 100, D: 100 },
        })).toBe('C');
    });

    it('returns null when nothing in the viewport is measured', () => {
        const layout = uniformLayout();
        expect(pickCompensationAnchor({
            previousLayout: layout,
            nextLayout: layout,
            distanceFromBottomPx: 175,
            viewportHeightPx: 150,
            measuredHeightsByKey: {},
        })).toBeNull();
    });
});

describe('jump positioning', () => {
    it('aligns an entry top at the requested inset', () => {
        const layout = uniformLayout();
        // A's top edge is 500 from the bottom; viewport 150 with 10px inset.
        expect(distanceToAlignEntryTop({ layout, key: 'A', viewportHeightPx: 150, topInsetPx: 10 })).toBe(360);
        // Near the bottom the distance clamps to 0.
        expect(distanceToAlignEntryTop({ layout, key: 'E', viewportHeightPx: 150, topInsetPx: 10 })).toBe(0);
    });

    it('centers an entry in the viewport', () => {
        const layout = uniformLayout();
        // C spans 200–300 from the bottom; centered in a 150px viewport → [175, 325].
        expect(distanceToCenterEntry({ layout, key: 'C', viewportHeightPx: 150 })).toBe(175);
        expect(distanceToCenterEntry({ layout, key: 'Z', viewportHeightPx: 150 })).toBeNull();
    });
});

describe('nextViewportState', () => {
    const layout = uniformLayout();
    const base: ViewportState = {
        distanceFromBottomPx: 175,
        renderedRange: { startIndex: 0, endIndex: 5 },
        keys: layout.keys,
        viewportHeightPx: 150,
    };

    it('returns the same object when nothing changes', () => {
        const next = nextViewportState({
            current: base,
            layout,
            distanceFromBottomPx: 175,
            viewportHeightPx: 150,
            overscanCount: 0,
        });
        expect(next).toBe(base);
    });

    it('keeps the window while it still covers the needed range (hysteresis)', () => {
        const next = nextViewportState({
            current: base,
            layout,
            distanceFromBottomPx: 60,
            viewportHeightPx: 150,
            overscanCount: 0,
        });
        expect(next).not.toBe(base);
        expect(next.renderedRange).toEqual(base.renderedRange);
        expect(next.distanceFromBottomPx).toBe(60);
    });

    it('recomputes the window when the needed range escapes it', () => {
        const current: ViewportState = { ...base, renderedRange: { startIndex: 3, endIndex: 5 }, distanceFromBottomPx: 0 };
        const next = nextViewportState({
            current,
            layout,
            distanceFromBottomPx: 175,
            viewportHeightPx: 150,
            overscanCount: 0,
        });
        expect(next.renderedRange).toEqual({ startIndex: 1, endIndex: 4 });
    });

    it('drops the hysteresis when the entry set changes', () => {
        const grown = buildLayoutModel({
            keys: ['P', ...KEYS],
            measuredHeightsByKey: {},
            estimateHeightPx: 100,
        });
        const next = nextViewportState({
            current: base,
            layout: grown,
            distanceFromBottomPx: 175,
            viewportHeightPx: 150,
            overscanCount: 0,
        });
        expect(next.keys).toBe(grown.keys);
        expect(next.renderedRange).toEqual({ startIndex: 2, endIndex: 5 });
    });

    it('clamps the distance into the content', () => {
        const next = nextViewportState({
            current: base,
            layout,
            distanceFromBottomPx: 10_000,
            viewportHeightPx: 150,
            overscanCount: 0,
        });
        expect(next.distanceFromBottomPx).toBe(500);
    });
});

describe('helpers', () => {
    it('rangeContains', () => {
        expect(rangeContains({ startIndex: 0, endIndex: 5 }, { startIndex: 1, endIndex: 4 })).toBe(true);
        expect(rangeContains({ startIndex: 2, endIndex: 5 }, { startIndex: 1, endIndex: 4 })).toBe(false);
    });

    it('sameKeys', () => {
        expect(sameKeys(KEYS, [...KEYS])).toBe(true);
        expect(sameKeys(KEYS, KEYS.slice(0, 4))).toBe(false);
    });
});

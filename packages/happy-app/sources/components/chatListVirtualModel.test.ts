import { describe, expect, it } from 'vitest';
import {
    buildLayoutModel,
    computeVisibleRange,
    distanceToCenterEntry,
    entryTopFromBottom,
    minimumCanvasHeightPx,
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

    it('gives a folded entry no height but keeps its measurement', () => {
        const measured = { C: 240, D: 150 };
        const layout = buildLayoutModel({
            keys: KEYS,
            measuredHeightsByKey: measured,
            estimateHeightPx: 100,
            collapsedKeys: new Set(['C']),
        });
        expect(layout.heightsPx).toEqual([100, 100, 0, 150, 100]);
        expect(layout.totalHeightPx).toBe(450);
        expect(layout.topOffsetsPx).toEqual([0, 100, 200, 200, 350]);
        // The measurement survives: an expand animation needs its endpoint.
        expect(measured.C).toBe(240);
        // ...and so a layout rebuilt without the fold comes back unchanged.
        expect(buildLayoutModel({ keys: KEYS, measuredHeightsByKey: measured, estimateHeightPx: 100 }).heightsPx)
            .toEqual([100, 100, 240, 150, 100]);
    });

    it('applies a minimum height to a measured entry', () => {
        const layout = buildLayoutModel({
            keys: KEYS,
            measuredHeightsByKey: { C: 12 },
            estimateHeightPx: 100,
            minHeightsByKey: { C: 64 },
        });
        expect(layout.heightsPx[2]).toBe(64);
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

    it('keeps the newest entry in the window at the very bottom', () => {
        // E is folded away, so it is zero-height and a binary search over
        // offsets cannot see it: without the rule the newest entry is dropped.
        const layout = buildLayoutModel({
            keys: KEYS,
            measuredHeightsByKey: { A: 100, B: 100, C: 100, D: 100, E: 100 },
            estimateHeightPx: 100,
            collapsedKeys: new Set(['E']),
        });
        expect(computeVisibleRange({ layout, distanceFromBottomPx: 0, viewportHeightPx: 100, overscanCount: 0 }))
            .toEqual({ startIndex: 3, endIndex: 4 });
        expect(computeVisibleRange({
            layout,
            distanceFromBottomPx: 0,
            viewportHeightPx: 100,
            overscanCount: 0,
            collapseEmptyRows: true,
        })).toEqual({ startIndex: 3, endIndex: 5 });
    });

    it('keeps the oldest entry in the window at the very top', () => {
        const layout = buildLayoutModel({
            keys: KEYS,
            measuredHeightsByKey: { A: 100, B: 100, C: 100, D: 100, E: 100 },
            estimateHeightPx: 100,
            collapsedKeys: new Set(['A']),
        });
        const distanceFromBottomPx = layout.totalHeightPx;
        expect(computeVisibleRange({ layout, distanceFromBottomPx, viewportHeightPx: 100, overscanCount: 0 }))
            .toEqual({ startIndex: 1, endIndex: 2 });
        expect(computeVisibleRange({
            layout,
            distanceFromBottomPx,
            viewportHeightPx: 100,
            overscanCount: 0,
            collapseEmptyRows: true,
        })).toEqual({ startIndex: 0, endIndex: 1 });
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

    it('never anchors on a gap or on a folded (zero-height) entry', () => {
        const previousLayout = buildLayoutModel({
            keys: KEYS,
            measuredHeightsByKey: { C: 100, D: 100, E: 100 },
            estimateHeightPx: 100,
            collapsedKeys: new Set(['C']),
        });
        // Viewport [150, 300]: C is measured but folded away, D is the anchor.
        expect(pickCompensationAnchor({
            previousLayout,
            nextLayout: previousLayout,
            distanceFromBottomPx: 150,
            viewportHeightPx: 150,
            measuredHeightsByKey: { C: 100, D: 100, E: 100 },
            collapseEmptyRows: true,
        })).toBe('D');
        // Without the collapse flag the zero-height entry is fair game again.
        expect(pickCompensationAnchor({
            previousLayout,
            nextLayout: previousLayout,
            distanceFromBottomPx: 150,
            viewportHeightPx: 150,
            measuredHeightsByKey: { C: 100, D: 100, E: 100 },
        })).toBe('C');
        // And a spacing entry is never an anchor, whatever its height.
        expect(pickCompensationAnchor({
            previousLayout,
            nextLayout: previousLayout,
            distanceFromBottomPx: 150,
            viewportHeightPx: 150,
            measuredHeightsByKey: { C: 100, D: 100, E: 100 },
            gapKeys: new Set(['D']),
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

describe('distanceToCenterEntry', () => {
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

describe('entryTopFromBottom', () => {
    it('returns the distance from the content bottom to the entry top', () => {
        const layout = uniformLayout({ D: 150 });
        // E: bottom 0 + height 100; D: bottom 100 + height 150.
        expect(entryTopFromBottom(layout, 'E')).toBe(100);
        expect(entryTopFromBottom(layout, 'D')).toBe(250);
        expect(entryTopFromBottom(layout, 'A')).toBe(550);
    });

    it('returns null for unknown keys', () => {
        expect(entryTopFromBottom(uniformLayout(), 'nope')).toBeNull();
    });

    it('is invariant under a prepend and shifts by an append, which is what a compensation reads', () => {
        const before = uniformLayout();
        const prepended = buildLayoutModel({ keys: ['P', ...KEYS], measuredHeightsByKey: {}, estimateHeightPx: 100 });
        expect(entryTopFromBottom(prepended, 'C')).toBe(entryTopFromBottom(before, 'C'));
        const appended = buildLayoutModel({ keys: [...KEYS, 'Z'], measuredHeightsByKey: { Z: 40 }, estimateHeightPx: 100 });
        expect(entryTopFromBottom(appended, 'C')! - entryTopFromBottom(before, 'C')!).toBe(40);
    });
});

describe('minimumCanvasHeightPx', () => {
    it('uses the viewport space left after the header and footer', () => {
        expect(minimumCanvasHeightPx({ viewportHeightPx: 800, headerInsetPx: 120, footerHeightPx: 20 }))
            .toBe(660);
    });

    it('clamps to zero when fixed regions exceed the viewport', () => {
        expect(minimumCanvasHeightPx({ viewportHeightPx: 100, headerInsetPx: 80, footerHeightPx: 40 }))
            .toBe(0);
    });
});

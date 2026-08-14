// Pure layout math for the web ChatList virtualizer (ChatList.web.tsx).
//
// Port of the model at the core of Codex's thread virtualizer, at message
// granularity. Every coordinate is BOTTOM-ANCHORED:
//   - distanceFromBottomPx: how far the viewport's bottom edge sits above the
//     content's bottom edge (= |scrollTop| in a column-reverse scroller).
//   - bottomOffsetPx of an entry: the space below the entry's bottom edge.
// Entries are in chronological order (index 0 = oldest), so topOffsetsPx is
// ascending and bottomOffsetsPx is descending.
//
// Bottom-anchored coordinates are what make windowing safe here: estimate
// errors ABOVE the viewport never move it, and errors BELOW it are corrected
// by a single scroll adjustment computed from this model (no DOM reads).

export interface LayoutModel {
    /** Entry keys, oldest first. */
    keys: string[];
    heightsPx: number[];
    /** Distance from the content top to each entry's top edge (ascending). */
    topOffsetsPx: number[];
    /** Distance from the content bottom to each entry's bottom edge (descending). */
    bottomOffsetsPx: number[];
    totalHeightPx: number;
    indexByKey: Map<string, number>;
}

export interface RenderRange {
    startIndex: number;
    /** Exclusive. */
    endIndex: number;
}

export interface ViewportState {
    /** Model-space distance (footer padding already subtracted). */
    distanceFromBottomPx: number;
    renderedRange: RenderRange;
    /** The keys the range indexes into — detects entry-set changes. */
    keys: string[];
    viewportHeightPx: number;
}

export function buildLayoutModel(args: {
    keys: string[];
    measuredHeightsByKey: Record<string, number>;
    estimateHeightPx: number;
}): LayoutModel {
    const { keys, measuredHeightsByKey, estimateHeightPx } = args;
    const count = keys.length;
    const heightsPx = new Array<number>(count);
    const topOffsetsPx = new Array<number>(count);
    const indexByKey = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < count; i++) {
        const key = keys[i];
        const height = measuredHeightsByKey[key] ?? estimateHeightPx;
        indexByKey.set(key, i);
        topOffsetsPx[i] = total;
        heightsPx[i] = height;
        total += height;
    }
    const bottomOffsetsPx = new Array<number>(count);
    for (let i = 0; i < count; i++) {
        bottomOffsetsPx[i] = total - topOffsetsPx[i] - heightsPx[i];
    }
    return { keys, heightsPx, topOffsetsPx, bottomOffsetsPx, totalHeightPx: total, indexByKey };
}

// The entries intersecting [distance, distance + viewportHeight] from the
// bottom, padded by overscanCount on both sides.
export function computeVisibleRange(args: {
    layout: LayoutModel;
    distanceFromBottomPx: number;
    viewportHeightPx: number;
    overscanCount: number;
}): RenderRange {
    const { layout, overscanCount } = args;
    const count = layout.keys.length;
    if (count === 0) return { startIndex: 0, endIndex: 0 };
    const bottomEdge = Math.min(Math.max(0, args.distanceFromBottomPx), layout.totalHeightPx);
    const topEdge = Math.min(bottomEdge + Math.max(0, args.viewportHeightPx), layout.totalHeightPx);
    const first = firstIndexWithBottomBelow(layout.bottomOffsetsPx, topEdge);
    const pastLast = firstIndexWithTopAtOrBelow(layout.bottomOffsetsPx, layout.heightsPx, bottomEdge);
    return {
        startIndex: Math.max(0, first - overscanCount),
        endIndex: Math.min(count, Math.max(pastLast, first + 1) + overscanCount),
    };
}

// bottomOffsetsPx is descending: first index whose bottom edge is strictly
// below `limit` = the topmost entry that pokes under the viewport's top edge.
function firstIndexWithBottomBelow(bottomOffsetsPx: number[], limit: number): number {
    let lo = 0;
    let hi = bottomOffsetsPx.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((bottomOffsetsPx[mid] ?? 0) < limit) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}

// First index whose TOP edge (bottomOffset + height) is at or below `limit`
// = one past the bottommost entry still intersecting the viewport's bottom edge.
function firstIndexWithTopAtOrBelow(bottomOffsetsPx: number[], heightsPx: number[], limit: number): number {
    let lo = 0;
    let hi = bottomOffsetsPx.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((bottomOffsetsPx[mid] ?? 0) + (heightsPx[mid] ?? 0) <= limit) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}

// Teleport the window so it starts at the anchor, preserving the window size.
// Used when the entry set changes (the old range's indices no longer point at
// the same entries) and when jumping.
export function rangeAroundAnchor(args: {
    layout: LayoutModel;
    anchorKey: string;
    previousRange: RenderRange;
}): RenderRange | null {
    const index = args.layout.indexByKey.get(args.anchorKey);
    if (index == null) return null;
    const size = args.previousRange.endIndex - args.previousRange.startIndex;
    return { startIndex: index, endIndex: Math.min(args.layout.keys.length, index + size) };
}

// Distance from the content bottom to the entry's TOP edge.
export function entryTopFromBottom(layout: LayoutModel, key: string): number | null {
    const index = layout.indexByKey.get(key);
    if (index == null) return null;
    return (layout.bottomOffsetsPx[index] ?? 0) + (layout.heightsPx[index] ?? 0);
}

// The scroll distance that keeps the anchor entry's TOP edge at the same
// viewport position across a layout change.
export function compensatedDistanceFromBottom(args: {
    anchorKey: string;
    distanceFromBottomPx: number;
    previousLayout: LayoutModel;
    nextLayout: LayoutModel;
}): number | null {
    const prevTopFromBottom = entryTopFromBottom(args.previousLayout, args.anchorKey);
    const nextTopFromBottom = entryTopFromBottom(args.nextLayout, args.anchorKey);
    if (prevTopFromBottom == null || nextTopFromBottom == null) return null;
    return Math.max(0, args.distanceFromBottomPx + nextTopFromBottom - prevTopFromBottom);
}

// Extra empty canvas above the content top. It is the physical headroom that
// lets the window absorb content growth (page prepends, measurement
// corrections of rows entering from the top) WITHOUT resizing the canvas —
// scrollHeight changes mid-gesture are what desktop engines answer with an
// asynchronous scroll adjustment (the visible jump). When the whole history is
// loaded and the viewport is reading near the content top, the slack would be
// scrollable blank above the oldest message, so it collapses (with hysteresis
// so renormalizations don't flap around the boundary).
export function desiredTopSlackPx(args: {
    hasMore: boolean;
    totalHeightPx: number;
    viewportTopModelPx: number;
    currentSlackPx: number;
    maxSlackPx: number;
}): number {
    if (args.hasMore) return args.maxSlackPx;
    const collapseBandPx = args.currentSlackPx <= 0 ? 2400 : 1200;
    if (args.viewportTopModelPx > args.totalHeightPx - collapseBandPx) return 0;
    return args.maxSlackPx;
}

// The canvas sits between the list's header spacer and footer inside the
// scroller. Keeping it at least as tall as the remaining viewport prevents a
// short, newly-mounted conversation from being clipped by the canvas while
// its estimated row heights are replaced with real measurements.
export function minimumCanvasHeightPx(args: {
    viewportHeightPx: number;
    headerInsetPx: number;
    footerHeightPx: number;
}): number {
    return Math.max(0, args.viewportHeightPx - args.headerInsetPx - args.footerHeightPx);
}

// First measured entry inside the strict viewport (no overscan) present in
// both layouts — the compensation anchor for an entry-set change. Measured
// only: an estimated height would make the compensation itself a guess.
export function pickCompensationAnchor(args: {
    previousLayout: LayoutModel;
    nextLayout: LayoutModel;
    distanceFromBottomPx: number;
    viewportHeightPx: number;
    measuredHeightsByKey: Record<string, number>;
}): string | null {
    const range = computeVisibleRange({
        layout: args.previousLayout,
        distanceFromBottomPx: args.distanceFromBottomPx,
        viewportHeightPx: args.viewportHeightPx,
        overscanCount: 0,
    });
    for (let i = range.startIndex; i < range.endIndex; i++) {
        const key = args.previousLayout.keys[i];
        if (key != null && args.measuredHeightsByKey[key] != null && args.nextLayout.indexByKey.has(key)) {
            return key;
        }
    }
    return null;
}

// Distance that places the entry's top edge `topInsetPx` below the viewport top.
export function distanceToAlignEntryTop(args: {
    layout: LayoutModel;
    key: string;
    viewportHeightPx: number;
    topInsetPx: number;
}): number | null {
    const index = args.layout.indexByKey.get(args.key);
    if (index == null) return null;
    const topFromBottom = (args.layout.bottomOffsetsPx[index] ?? 0) + (args.layout.heightsPx[index] ?? 0);
    return Math.max(0, topFromBottom - args.viewportHeightPx + args.topInsetPx);
}

// Distance that centers the entry in the viewport.
export function distanceToCenterEntry(args: {
    layout: LayoutModel;
    key: string;
    viewportHeightPx: number;
}): number | null {
    const index = args.layout.indexByKey.get(args.key);
    if (index == null) return null;
    return Math.max(
        0,
        (args.layout.bottomOffsetsPx[index] ?? 0) - args.viewportHeightPx / 2 + (args.layout.heightsPx[index] ?? 0) / 2,
    );
}

export function rangeContains(outer: RenderRange, inner: RenderRange): boolean {
    return outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex;
}

export function sameKeys(a: string[], b: string[]): boolean {
    return a === b || (a.length === b.length && a.every((key, i) => key === b[i]));
}

// Next viewport state for a scroll/resize. Hysteresis: while the current
// window still covers the needed range (and the entry set is unchanged), keep
// it — small scrolls then cause zero React commits. Returns the SAME object
// when nothing changes so callers can skip setState entirely.
export function nextViewportState(args: {
    current: ViewportState;
    layout: LayoutModel;
    distanceFromBottomPx: number;
    viewportHeightPx: number;
    overscanCount: number;
}): ViewportState {
    const { current, layout } = args;
    const clamped = Math.min(Math.max(0, args.distanceFromBottomPx), layout.totalHeightPx);
    const needed = computeVisibleRange({
        layout,
        distanceFromBottomPx: clamped,
        viewportHeightPx: args.viewportHeightPx,
        overscanCount: args.overscanCount,
    });
    const keysUnchanged = sameKeys(current.keys, layout.keys);
    const range = keysUnchanged && rangeContains(current.renderedRange, needed) ? current.renderedRange : needed;
    if (
        current.distanceFromBottomPx === clamped
        && current.viewportHeightPx === args.viewportHeightPx
        && current.renderedRange.startIndex === range.startIndex
        && current.renderedRange.endIndex === range.endIndex
        && keysUnchanged
    ) {
        return current;
    }
    return {
        distanceFromBottomPx: clamped,
        renderedRange: range,
        keys: layout.keys,
        viewportHeightPx: args.viewportHeightPx,
    };
}

/**
 * Geometry for the conversation minimap: where the rail sits, which landmark a point on it means,
 * and how the preview card is placed. Pure functions only — no React, no native — so the mapping can
 * be unit-tested without a device.
 *
 * The rail is a *fixed* strip: the landmarks under the finger never move, and the window of drawn
 * marks follows the landmark the reader is on, not the finger. A finger sliding along it therefore
 * picks marks the way a contact list's letter index does.
 */

/** Vertical pitch of one mark on the web rail. */
export const MARKER_SLOT_HEIGHT = 10;
/** Vertical pitch of one mark on the touch rail: wider than the web's so a mark is a finger-sized target. */
export const TOUCH_SLOT_HEIGHT = 12;
export const MARKER_WIDTH = 7;
export const MARKER_HEIGHT = 2;
/** A short band still shows this many marks, so the rail never collapses to a stub. */
export const MIN_VISIBLE_ITEMS = 8;
/** Below this many landmarks there is nothing to navigate. */
export const MIN_ITEMS = 2;
/** Two ticks closer together than this read as one. */
export const MIN_TICK_INTERVAL_MS = 45;
/** Sideways travel from the edge that reads as "summon the rail" rather than "scroll the list". */
export const REVEAL_DX = 10;
/**
 * Up-or-down travel that reads as a scroll instead. Looser than `REVEAL_DX` on purpose and checked
 * first: a thumb sweeping in from the edge arcs downwards, so with the two the other way round the
 * arc would win the race and the rail would only ever come out for a perfectly level swipe.
 */
export const REVEAL_FAIL_DY = 30;
/** Slack around a mark's half-pitch before the selection moves, so a resting finger cannot flicker. */
const HYSTERESIS = 2;

export type ScrubBand = { top: number; height: number };

export type ScrubLayout = {
    band: ScrubBand;
    /** Pitch of one mark. */
    slot: number;
    /** How many marks the band shows at once. */
    slots: number;
};

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

/** Marks nearer the finger are drawn wider, up to 4×. */
export function getHoverScale(distance: number) {
    if (distance <= 0) return 4;
    if (distance === 1) return 3.4;
    if (distance === 2) return 2.8;
    if (distance === 3) return 2.2;
    if (distance === 4) return 1.6;
    return 1;
}

/** How many marks fit in `availableHeight`. Zero means "not measured yet", which draws the whole list. */
export function maxVisibleSlots(availableHeight: number, slot: number, total: number) {
    if (availableHeight <= 0) return total;
    return Math.min(total, Math.max(MIN_VISIBLE_ITEMS, Math.floor(availableHeight / slot)));
}

/** First landmark of the window: centred on `index`, then clamped so the window never runs off the list. */
export function windowStartFor(index: number, slots: number, total: number) {
    return clamp(index - Math.floor(slots / 2), 0, Math.max(0, total - slots));
}

export function scrubLayout(band: ScrubBand, slot: number, total: number): ScrubLayout {
    return { band, slot, slots: maxVisibleSlots(band.height, slot, total) };
}

/** Top of the drawn window: centred in the band, so slack is split above and below rather than pooled at the bottom. */
export function railTopForWindow(band: ScrubBand, slot: number, shown: number) {
    return band.top + Math.max(0, band.height - shown * slot) / 2;
}

/**
 * The landmark a finger at `y` picks: the slot it lands in, clamped to the drawn window, so dragging
 * past either end of the rail stays on the window's first or last landmark. The current landmark is
 * kept until the finger is clear of its slot — a finger resting on a boundary cannot flicker between
 * two landmarks. A current landmark outside the window has no slot centre to measure against, so the
 * pick is taken as is.
 */
export function indexAtRail(layout: ScrubLayout, total: number, railTop: number, y: number, current: number, windowStart: number) {
    const slot = clamp(Math.floor((y - railTop) / layout.slot), 0, Math.max(0, layout.slots - 1));
    const next = clamp(windowStart + slot, 0, Math.max(0, total - 1));
    if (next === current) return current;
    if (current < windowStart || current >= windowStart + layout.slots) return next;
    const center = railTop + (current - windowStart + 0.5) * layout.slot;
    return Math.abs(y - center) > layout.slot / 2 + HYSTERESIS ? next : current;
}

/** Top of the preview card: centred on the finger, kept inside the band. */
export function cardTopAtOffset(layout: ScrubLayout, cardHeight: number, y: number) {
    const bottom = layout.band.top + Math.max(0, layout.band.height - cardHeight);
    return clamp(y - cardHeight / 2, layout.band.top, bottom);
}

/** What a touch that started at the edge has turned out to be so far. */
export type EdgeSwipeReading = 'pending' | 'reveal' | 'scroll';

/**
 * Reads a movement that began on the right edge, measured from where the finger started.
 *
 * `pending` means the finger has not travelled far enough to say; the caller keeps asking. Only a
 * finger that commits sideways before it commits up or down is summoning the rail — everything else is
 * a scroll, and the list, which owns those touches already, is welcome to it.
 */
export function readEdgeSwipe(dx: number, dy: number): EdgeSwipeReading {
    if (Math.abs(dy) >= REVEAL_FAIL_DY) return 'scroll';
    if (Math.abs(dx) >= REVEAL_DX) return 'reveal';
    return 'pending';
}

/**
 * Rate-limited haptic ticks: the first crossing always ticks, later ones only `minIntervalMs` apart.
 * A rejected tick leaves the clock alone, so a fast drag ticks as soon as the interval is up.
 */
export function createTickGate(minIntervalMs: number) {
    let last = Number.NEGATIVE_INFINITY;
    return (now: number) => {
        if (now - last < minIntervalMs) return false;
        last = now;
        return true;
    };
}

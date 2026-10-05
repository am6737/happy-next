import { describe, it, expect } from 'vitest';
import {
    MIN_TICK_INTERVAL_MS,
    REVEAL_DX,
    REVEAL_FAIL_DY,
    readEdgeSwipe,
    MIN_VISIBLE_ITEMS,
    TOUCH_SLOT_HEIGHT,
    cardTopAtOffset,
    createTickGate,
    getHoverScale,
    indexAtRail,
    maxVisibleSlots,
    railTopForWindow,
    scrubLayout,
    windowStartFor,
} from './minimapScrubber';

const band = { top: 100, height: 400 };

describe('maxVisibleSlots', () => {
    it('draws every landmark before the band has been measured', () => {
        expect(maxVisibleSlots(0, TOUCH_SLOT_HEIGHT, 5)).toBe(5);
    });

    it('keeps the minimum rail even when the band is short', () => {
        expect(maxVisibleSlots(50, TOUCH_SLOT_HEIGHT, 100)).toBe(MIN_VISIBLE_ITEMS);
    });

    it('fills a tall band and never exceeds the landmark count', () => {
        expect(maxVisibleSlots(400, TOUCH_SLOT_HEIGHT, 500)).toBe(33);
        expect(maxVisibleSlots(400, TOUCH_SLOT_HEIGHT, 10)).toBe(10);
    });
});

describe('windowStartFor', () => {
    it('centres the selected landmark', () => {
        expect(windowStartFor(50, 11, 100)).toBe(45);
    });

    it('clamps to both ends so the window never runs off the list', () => {
        expect(windowStartFor(0, 11, 100)).toBe(0);
        expect(windowStartFor(1, 11, 100)).toBe(0);
        expect(windowStartFor(99, 11, 100)).toBe(89);
    });

    it('returns zero when the window covers the whole list', () => {
        expect(windowStartFor(3, 10, 4)).toBe(0);
    });
});

describe('scrubLayout', () => {
    it('lays the rail out from the band and the landmark count', () => {
        const layout = scrubLayout(band, TOUCH_SLOT_HEIGHT, 100);
        expect(layout.slots).toBe(Math.floor(band.height / TOUCH_SLOT_HEIGHT));
        expect(layout.slot).toBe(TOUCH_SLOT_HEIGHT);
    });

    it('still lays out a single landmark', () => {
        const layout = scrubLayout(band, TOUCH_SLOT_HEIGHT, 1);
        expect(layout.slots).toBe(1);
        expect(indexAtRail(layout, 1, band.top, 300, -1, 0)).toBe(0);
    });
});

describe('railTopForWindow', () => {
    it('centres a short window in the band', () => {
        // 20 marks of 12pt = 240pt in a 400pt band: 80pt of slack above and below.
        expect(railTopForWindow(band, TOUCH_SLOT_HEIGHT, 20)).toBe(180);
    });

    it('sits at the band top once the window fills it', () => {
        expect(railTopForWindow(band, TOUCH_SLOT_HEIGHT, 400 / TOUCH_SLOT_HEIGHT)).toBe(band.top);
    });

    it('never runs above the band even if the window is taller than it', () => {
        expect(railTopForWindow(band, TOUCH_SLOT_HEIGHT, 100)).toBe(band.top);
    });
});

describe('indexAtRail', () => {
    const layout = scrubLayout(band, TOUCH_SLOT_HEIGHT, 101);
    const railTop = railTopForWindow(band, TOUCH_SLOT_HEIGHT, layout.slots);
    const active = 50;
    const windowStart = windowStartFor(active, layout.slots, 101);
    const at = (slot: number) => railTop + (slot + 0.5) * TOUCH_SLOT_HEIGHT;

    it('reads each mark as the landmark its slot holds', () => {
        expect(indexAtRail(layout, 101, railTop, at(0), -1, windowStart)).toBe(windowStart);
        expect(indexAtRail(layout, 101, railTop, at(5), -1, windowStart)).toBe(windowStart + 5);
    });

    it('picks the mark drawn under a finger that walks the whole rail', () => {
        // The rail is drawn from `windowStartFor(reader)` and the finger is read against that same
        // window; anchored on anything else the marks slide out from under the finger mid-drag, so
        // the landmark picked and the mark drawn at that height have to stay the same slot.
        let current = -1;
        for (let slot = 0; slot < layout.slots; slot++) {
            current = indexAtRail(layout, 101, railTop, at(slot), current, windowStart);
            expect(current).toBe(windowStart + slot);
        }
        for (let slot = layout.slots - 1; slot >= 0; slot--) {
            current = indexAtRail(layout, 101, railTop, at(slot), current, windowStart);
            expect(current).toBe(windowStart + slot);
        }
    });

    it('keeps a landmark while the finger stays inside its slot', () => {
        const picked = indexAtRail(layout, 101, railTop, at(12), -1, windowStart);
        expect(picked).toBe(windowStart + 12);
        expect(indexAtRail(layout, 101, railTop, at(12) + 3, picked, windowStart)).toBe(picked);
        expect(indexAtRail(layout, 101, railTop, at(12) - 3, picked, windowStart)).toBe(picked);
    });

    it('puts the reader’s own landmark in the middle of the rail', () => {
        const middle = Math.floor(layout.slots / 2);
        expect(windowStart + middle).toBe(active);
        expect(indexAtRail(layout, 101, railTop, at(middle), -1, windowStart)).toBe(active);
    });

    it('clamps to the window’s ends when the finger runs off the rail', () => {
        expect(indexAtRail(layout, 101, railTop, railTop - 500, -1, windowStart)).toBe(windowStart);
        expect(indexAtRail(layout, 101, railTop, railTop + 5000, -1, windowStart)).toBe(windowStart + layout.slots - 1);
    });

    it('holds the current landmark through a wobble at the boundary', () => {
        const center = at(10);
        expect(indexAtRail(layout, 101, railTop, center + TOUCH_SLOT_HEIGHT / 2 + 1, windowStart + 10, windowStart)).toBe(windowStart + 10);
    });

    it('moves once the finger is clear of the boundary', () => {
        const center = at(10);
        expect(indexAtRail(layout, 101, railTop, center + TOUCH_SLOT_HEIGHT / 2 + 3, windowStart + 10, windowStart)).toBe(windowStart + 11);
        expect(indexAtRail(layout, 101, railTop, center - TOUCH_SLOT_HEIGHT / 2 - 3, windowStart + 10, windowStart)).toBe(windowStart + 9);
    });

    it('takes the pick outright when the current landmark is not on the rail', () => {
        // Nothing to measure a boundary against, so no hysteresis — the finger decides.
        expect(indexAtRail(layout, 101, railTop, at(0), 90, windowStart)).toBe(windowStart);
    });
});

describe('cardTopAtOffset', () => {
    const layout = scrubLayout(band, TOUCH_SLOT_HEIGHT, 101);

    it('centres the card on the finger', () => {
        expect(cardTopAtOffset(layout, 120, 300)).toBe(240);
    });

    it('clamps inside the band at both ends', () => {
        expect(cardTopAtOffset(layout, 120, band.top + 10)).toBe(band.top);
        expect(cardTopAtOffset(layout, 120, band.top + band.height)).toBe(band.top + band.height - 120);
    });

    it('top-aligns a card taller than the band', () => {
        expect(cardTopAtOffset(layout, band.height + 50, 300)).toBe(band.top);
    });
});

describe('createTickGate', () => {
    it('fires the first tick and then throttles', () => {
        const gate = createTickGate(MIN_TICK_INTERVAL_MS);
        expect(gate(1000)).toBe(true);
        expect(gate(1000 + MIN_TICK_INTERVAL_MS - 1)).toBe(false);
        expect(gate(1000 + MIN_TICK_INTERVAL_MS)).toBe(true);
    });

    it('does not move the clock on a throttled tick', () => {
        const gate = createTickGate(MIN_TICK_INTERVAL_MS);
        expect(gate(0)).toBe(true);
        expect(gate(10)).toBe(false);
        expect(gate(MIN_TICK_INTERVAL_MS)).toBe(true);
    });
});

describe('readEdgeSwipe', () => {
    it('reads a swipe committed sideways as a summon', () => {
        expect(readEdgeSwipe(-REVEAL_DX, 0)).toBe('reveal');
        expect(readEdgeSwipe(-REVEAL_DX - 8, REVEAL_FAIL_DY - 1)).toBe('reveal');
        expect(readEdgeSwipe(REVEAL_DX, 0)).toBe('reveal');
    });

    it('leaves a movement too small to read undecided', () => {
        expect(readEdgeSwipe(-REVEAL_DX + 1, 0)).toBe('pending');
        expect(readEdgeSwipe(0, REVEAL_FAIL_DY - 1)).toBe('pending');
    });

    it('gives a scroll the benefit of the doubt once the finger has travelled up or down', () => {
        // A thumb sweeping in from the edge arcs downwards. Read the other way round, that arc would
        // win the race against the sideways travel and the rail would never come out.
        expect(readEdgeSwipe(-REVEAL_DX, REVEAL_FAIL_DY)).toBe('scroll');
        expect(readEdgeSwipe(-REVEAL_DX, -REVEAL_FAIL_DY)).toBe('scroll');
    });
});

describe('getHoverScale', () => {
    it('grows the marker under the finger and falls off with distance', () => {
        expect(getHoverScale(0)).toBe(4);
        expect(getHoverScale(1)).toBeGreaterThan(getHoverScale(2));
        expect(getHoverScale(4)).toBeGreaterThan(getHoverScale(5));
        expect(getHoverScale(40)).toBe(1);
    });
});

import { describe, expect, it } from 'vitest';
import { createScrollDistanceController, type ScrollElementLike } from './scrollDistanceController';

// A scroller that behaves like a real one on a fractional display: it cannot
// store every offset we ask for, it stores the nearest one it can represent.
// That refusal is the fuel of the original bug.
function createFakeScroller(params: { contentHeightPx: number; viewportHeightPx?: number; gridPx?: number | null }) {
    const gridPx = params.gridPx ?? null;
    let contentHeightPx = params.contentHeightPx;
    let scrollTopPx = 0;
    const el = {
        get scrollTop() {
            return scrollTopPx;
        },
        set scrollTop(value: number) {
            scrollTopPx = gridPx == null ? value : Math.round(value / gridPx) * gridPx;
        },
        get scrollHeight() {
            return contentHeightPx;
        },
        clientHeight: params.viewportHeightPx ?? 800,
    };
    return {
        el: el as ScrollElementLike,
        setContentHeightPx(px: number) {
            contentHeightPx = px;
        },
    };
}

function createDeferredScheduler() {
    const microtasks: Array<() => void> = [];
    const frames: Array<{ handle: number; fn: () => void; cancelled: boolean }> = [];
    let nextHandle = 1;
    return {
        scheduleMicrotask: (fn: () => void) => microtasks.push(fn),
        scheduleFrame: (fn: () => void) => {
            const handle = nextHandle++;
            frames.push({ handle, fn, cancelled: false });
            return handle;
        },
        cancelFrame: (handle: number) => {
            const frame = frames.find((candidate) => candidate.handle === handle);
            if (frame) frame.cancelled = true;
        },
        flushMicrotasks() {
            while (microtasks.length > 0) microtasks.shift()!();
        },
        flushFrames() {
            while (frames.length > 0) {
                const frame = frames.shift()!;
                if (!frame.cancelled) frame.fn();
            }
        },
    };
}

function createHarness(args: { contentHeightPx: number; gridPx?: number | null; startDistancePx?: number }) {
    const scroller = createFakeScroller({ contentHeightPx: args.contentHeightPx, gridPx: args.gridPx });
    const scheduler = createDeferredScheduler();
    const changes: number[] = [];
    let carryPx = 0;
    const controller = createScrollDistanceController({
        getElement: () => scroller.el,
        onDistanceChange: (distancePx) => changes.push(distancePx),
        scheduleMicrotask: scheduler.scheduleMicrotask,
        scheduleFrame: scheduler.scheduleFrame,
        cancelFrame: scheduler.cancelFrame,
    });
    controller.setDistancePx(args.startDistancePx ?? 0);
    const carry = {
        getPx: () => carryPx,
        setPx: (px: number) => {
            carryPx = px;
        },
    };
    return { controller, scroller, scheduler, changes, carry, getCarryPx: () => carryPx };
}

describe('scroll distance controller', () => {
    it('answers with the distance we asked for while the engine reports its own rounding', () => {
        const exact = createHarness({ contentHeightPx: 6000 });
        exact.controller.setDistancePx(1234.6);
        expect(exact.scroller.el.scrollTop).toBeCloseTo(-1234.6, 6);

        // An engine on a 1px grid cannot hold 1234.6: the DOM reports 1235.
        // Everything downstream must keep computing from 1234.6 anyway.
        const quantized = createHarness({ contentHeightPx: 6000, gridPx: 1 });
        quantized.controller.setDistancePx(1234.6);
        expect(quantized.scroller.el.scrollTop).toBeCloseTo(-1235, 6);
        expect(quantized.controller.readDistancePx()).toBeCloseTo(1235, 6);
        expect(quantized.controller.getRequestedDistancePx()).toBeCloseTo(1234.6, 6);
    });

    it('does not accumulate the write rounding over repeated fold/unfold cycles', () => {
        // 1/1.25 is the device pixel grid of a Windows display at 125%: the
        // scroller's own grid, and the layout's as well.
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 / 1.25, startDistancePx: 1234.6 });
        const startingDistancePx = harness.controller.getRequestedDistancePx();
        for (let cycle = 0; cycle < 40; cycle += 1) {
            harness.controller.applyHeightDeltaPx(-487.35, harness.carry);
            harness.controller.applyHeightDeltaPx(487.35, harness.carry);
            expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(startingDistancePx, 6);
        }
        expect(harness.getCarryPx()).toBe(0);
    });

    it('documents the shape of the bug: a compensation read off the screen walks, one rounding per cycle', () => {
        // The old fold path let the DOM back into the arithmetic: the height the
        // model removed came from measurement while the compensation it applied
        // came from the on-screen box. At 125% a row measured at 487.36 CSS px
        // paints as 609 device px and reports 487.2 back, so the pair does not
        // cancel — it walks in one direction, which is why the line crept a
        // little on every toggle and was only obvious after several.
        // The exact engine numbers here are a model, not an emulation. What the
        // test pins down is certain: the corrected path's result must not depend
        // on the screen's rounding at all, while this one does.
        const rowHeightPx = 487.36;
        const reportedRowHeightPx = Math.floor(rowHeightPx * 1.25) / 1.25;
        expect(reportedRowHeightPx).toBeLessThan(rowHeightPx);
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 / 1.25, startDistancePx: 1234.6 });
        const startingDistancePx = harness.controller.getRequestedDistancePx();
        for (let cycle = 0; cycle < 40; cycle += 1) {
            harness.controller.applyHeightDeltaPx(-rowHeightPx, harness.carry);
            harness.controller.applyHeightDeltaPx(reportedRowHeightPx, harness.carry);
        }
        expect(startingDistancePx - harness.controller.getRequestedDistancePx()).toBeGreaterThan(4);
    });

    it('survives the offset collapse a renormalization performs, out and back', () => {
        // Renormalization folds a canvas offset into the scroll distance and writes the sum as an
        // absolute distance: `wanted = distance + offset`. It runs on every toggle, and the offset
        // is the reader's own number, so the sum has to be made from the distance we asked for —
        // not from the one the engine kept. The pair of writes is the whole test: built from the
        // intent they cancel exactly, which is what keeps a fold from moving the line above it.
        const offsetPx = 1737.44;
        const harness = createHarness({ contentHeightPx: 9000, gridPx: 1 / 1.25, startDistancePx: 1252.31 });
        for (let round = 0; round < 20; round += 1) {
            harness.controller.setDistancePx(harness.controller.getRequestedDistancePx() + offsetPx);
            harness.controller.setDistancePx(harness.controller.getRequestedDistancePx() - offsetPx);
        }
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(1252.31, 6);
        // The engine never held that number even once: the grid it rounds to is 1/1.25.
        expect(harness.controller.readDistancePx()).not.toBeCloseTo(1252.31, 2);
    });

    it('forgets the intent as soon as the DOM reports something else', () => {
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1, startDistancePx: 500 });
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(500, 6);
        // A real user scroll: the DOM moved, so the record is spent.
        harness.scroller.el.scrollTop = -1200;
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(1200, 6);
        harness.controller.clearIntent();
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(1200, 6);
    });

    it('never records a write at either end of the range, where the DOM is exact', () => {
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 });
        harness.controller.setDistancePx(0);
        expect(harness.controller.getRequestedDistancePx()).toBe(0);
        // 6000 - 800 is the furthest offset: the engine lands on it exactly.
        harness.controller.setDistancePx(5200);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(5200, 6);
    });

    it('takes a deficit that would go past the bottom out of the carry', () => {
        const harness = createHarness({ contentHeightPx: 6000 });
        harness.carry.setPx(300);
        harness.controller.applyHeightDeltaPx(-120, harness.carry);
        // distance was 0, so the whole 120 has to live in the carry.
        expect(harness.controller.getRequestedDistancePx()).toBe(0);
        expect(harness.getCarryPx()).toBe(420);
    });

    it('clamps instead of touching a carry that is too small to be slack', () => {
        const harness = createHarness({ contentHeightPx: 6000 });
        harness.carry.setPx(10);
        harness.controller.applyHeightDeltaPx(-120, harness.carry);
        expect(harness.controller.getRequestedDistancePx()).toBe(0);
        expect(harness.getCarryPx()).toBe(10);
    });

    it('puts the viewport back when the content height changed under it', () => {
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 900 });
        harness.controller.preserveScrollPositionForNextLayout();
        harness.scroller.setContentHeightPx(6300);
        harness.scheduler.flushMicrotasks();
        // Growing the content by 300 moves what is on screen unless we move
        // toward the bottom by the same 300: 900 -> 600.
        expect(harness.changes).toEqual([600]);
        // The frame pass finds the position already corrected and stays quiet.
        harness.scheduler.flushFrames();
        expect(harness.changes).toEqual([600]);
    });

    it('stands down when the viewport already moved by the time the layout lands', () => {
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 900 });
        harness.controller.preserveScrollPositionForNextLayout();
        harness.scroller.setContentHeightPx(6300);
        harness.scroller.el.scrollTop = -700;
        harness.scheduler.flushMicrotasks();
        harness.scheduler.flushFrames();
        expect(harness.changes).toEqual([]);
    });

    it('cancels the frame pass when the height never changed', () => {
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 900 });
        harness.controller.preserveScrollPositionForNextLayout();
        harness.scheduler.flushMicrotasks();
        harness.scheduler.flushFrames();
        expect(harness.changes).toEqual([]);
    });
});

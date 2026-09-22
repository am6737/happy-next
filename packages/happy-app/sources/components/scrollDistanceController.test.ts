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

function createHarness(args: { contentHeightPx: number; gridPx?: number | null; startDistancePx?: number }) {
    const scroller = createFakeScroller({ contentHeightPx: args.contentHeightPx, gridPx: args.gridPx });
    const controller = createScrollDistanceController({ getElement: () => scroller.el });
    controller.setDistancePx(args.startDistancePx ?? 0);
    return { controller, scroller };
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
        // 1/1.25 is the device pixel grid of a Windows display at 125%: the scroller's own grid, and
        // the layout's as well. A cycle is the pair of writes a fold and its unfold make — remove a
        // row's height from the distance, then put it back — each one computed from the intent.
        const rowHeightPx = 487.35;
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 / 1.25, startDistancePx: 1234.6 });
        const startingDistancePx = harness.controller.getRequestedDistancePx();
        for (let cycle = 0; cycle < 40; cycle += 1) {
            harness.controller.setDistancePx(harness.controller.getRequestedDistancePx() - rowHeightPx);
            harness.controller.setDistancePx(harness.controller.getRequestedDistancePx() + rowHeightPx);
            expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(startingDistancePx, 6);
        }
    });

    it('cannot rescue a caller that measures the fold height off the screen instead of the model', () => {
        // The fold had two numbers where it should have had one. The height it removed came from the
        // model; the height it put back came from the row's on-screen box. At 125% a row measured at
        // 487.36 CSS px paints as 609 device px and reports 487.2 back, so the pair does not cancel —
        // it walks 0.16px in one direction per toggle, which is why the line crept a little each time
        // and was only obvious after several.
        // Both loops below write through the same controller, whose job is to keep the arithmetic off
        // the DOM. It does that job: the difference between them is only which number the caller
        // hands it, and the controller cannot tell a screen measurement from a model one.
        // The engine numbers here are a model, not an emulation. What the test pins down is certain:
        // the corrected path's result must not depend on the screen's rounding at all, while this one
        // does.
        const rowHeightPx = 487.36;
        const reportedRowHeightPx = Math.floor(rowHeightPx * 1.25) / 1.25;
        expect(reportedRowHeightPx).toBeLessThan(rowHeightPx);

        const fromModel = createHarness({ contentHeightPx: 6000, gridPx: 1 / 1.25, startDistancePx: 1234.6 });
        const fromScreen = createHarness({ contentHeightPx: 6000, gridPx: 1 / 1.25, startDistancePx: 1234.6 });
        const startingDistancePx = fromModel.controller.getRequestedDistancePx();
        for (let cycle = 0; cycle < 40; cycle += 1) {
            fromModel.controller.setDistancePx(fromModel.controller.getRequestedDistancePx() - rowHeightPx);
            fromModel.controller.setDistancePx(fromModel.controller.getRequestedDistancePx() + rowHeightPx);
            fromScreen.controller.setDistancePx(fromScreen.controller.getRequestedDistancePx() - rowHeightPx);
            fromScreen.controller.setDistancePx(fromScreen.controller.getRequestedDistancePx() + reportedRowHeightPx);
        }
        expect(fromModel.controller.getRequestedDistancePx()).toBeCloseTo(startingDistancePx, 6);
        expect(startingDistancePx - fromScreen.controller.getRequestedDistancePx()).toBeGreaterThan(4);
    });

    it('keeps a compensated pair of writes exact, out and back', () => {
        // Whatever geometry puts a number between us and the scroller — a footer that resized, a
        // window that reflowed — the compensation is a write of `intent + offset` followed by one of
        // `intent - offset`. Built from the intent they cancel exactly; built from the DOM they hand
        // the engine's rounding to the reader. The pair is the whole test.
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
    });

    it('never records a write at either end of the range, where the DOM is exact', () => {
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 });
        harness.controller.setDistancePx(0);
        expect(harness.controller.getRequestedDistancePx()).toBe(0);
        // 6000 - 800 is the furthest offset: the engine lands on it exactly.
        harness.controller.setDistancePx(5200);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(5200, 6);
    });
});

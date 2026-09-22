import { describe, expect, it } from 'vitest';
import { createScrollDistanceController, type ScrollElementLike } from './scrollDistanceController';

// A scroller that behaves like a real one on a fractional display: it cannot
// store every offset we ask for, it stores the nearest one it can represent.
// That refusal is the fuel of the original bug. It also clamps to the range it
// currently covers, the way a real one does the moment a layout shrinks under
// the viewport — the other half of that bug.
function createFakeScroller(params: { contentHeightPx: number; viewportHeightPx?: number; gridPx?: number | null }) {
    const gridPx = params.gridPx ?? null;
    let contentHeightPx = params.contentHeightPx;
    let scrollTopPx = 0;
    const el = {
        get scrollTop() {
            return scrollTopPx;
        },
        set scrollTop(value: number) {
            const quantized = gridPx == null ? value : Math.round(value / gridPx) * gridPx;
            // column-reverse: the offset lives in [-max, 0].
            const maxPx = Math.max(0, contentHeightPx - el.clientHeight);
            scrollTopPx = Math.min(0, Math.max(-maxPx, quantized));
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

    it('answers with where the reader left it once they scroll by hand', () => {
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1, startDistancePx: 500 });
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(500, 6);
        // A real user scroll — a wheel, a drag, a key. The caller says so, and then the DOM is the
        // truth: the intent is wherever they left the scroller.
        harness.scroller.el.scrollTop = -1200;
        harness.controller.adoptReportedDistancePx();
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(1200, 6);
    });

    it('keeps the reader’s distance when the engine clamps under a layout that shrank', () => {
        // A fold removes the height under the viewport (the 194-step turn of a real session: 19741px
        // of canvas down to 2088), and the offset the reader is holding no longer exists. The engine
        // clamps it to the new range on its own — nobody asked, and the reader has not moved.
        // Reading that clamp back as their position is the whole bug: the arithmetic starts 1157
        // short of where they are and floors out at 0, i.e. at the bottom of the conversation.
        const harness = createHarness({ contentHeightPx: 19741, startDistancePx: 18743 });
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(18743, 6);
        harness.scroller.setContentHeightPx(2088);
        harness.scroller.el.scrollTop = -18743; // the engine, clamping to the range it now covers
        expect(harness.controller.readDistancePx()).toBeCloseTo(1288, 6);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(18743, 6);
        // And the correction the fold makes — the height it took off the distance — lands back inside
        // the new range instead of on the bottom.
        harness.controller.setDistancePx(harness.controller.getRequestedDistancePx() - 17653);
        expect(harness.controller.readDistancePx()).toBeCloseTo(1090, 6);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(1090, 6);
    });

    it('keeps asking for a distance past the end of the range, until the range catches up', () => {
        // The row a fold's line sits on grows its content a frame after the layout does: the write
        // lands 67px past what the engine has laid out, and the engine clamps it. That is a refusal
        // to remember, not a position to adopt — the next correction computed from the clamped
        // number is what leaves the line the reader tapped sitting 67px off.
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 500 });
        harness.controller.setDistancePx(5267); // 6000 - 800 is all the range there is
        expect(harness.controller.readDistancePx()).toBeCloseTo(5200, 6);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(5267, 6);
    });

    it('answers at either end of the range with the request, exact or not', () => {
        const harness = createHarness({ contentHeightPx: 6000, gridPx: 1 });
        harness.controller.setDistancePx(0);
        expect(harness.controller.getRequestedDistancePx()).toBe(0);
        // 6000 - 800 is the furthest offset: the engine lands on it exactly.
        harness.controller.setDistancePx(5200);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(5200, 6);
    });

    it('leaves a write that landed alone, and a rounding the engine made with it', () => {
        const exact = createHarness({ contentHeightPx: 6000, startDistancePx: 500 });
        exact.controller.setDistancePx(1200);
        expect(exact.controller.settleRefusedWrite({ requestedPx: 1200, atRest: true })).toBe(null);

        // A grid of 1px reports 1200 back for 1199.6: the engine held what it was asked for, as
        // closely as it can hold anything. Nothing to settle.
        const quantized = createHarness({ contentHeightPx: 6000, gridPx: 1, startDistancePx: 500 });
        quantized.controller.setDistancePx(1199.6);
        expect(quantized.controller.readDistancePx()).toBeCloseTo(1200, 6);
        expect(quantized.controller.settleRefusedWrite({ requestedPx: 1199.6, atRest: true })).toBe(null);
    });

    it('asks again for a write the engine refused while its box was a frame short', () => {
        // The row a fold opens arrives in the commit after the arithmetic that accounted for it, so
        // the write asks for 5267 while the box only covers 5200 and the engine clamps it. One frame
        // later the box has the range: asking again is what puts the line back where the reader
        // tapped, instead of leaving them parked on the clamp.
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 500 });
        harness.controller.setDistancePx(5267);
        expect(harness.controller.readDistancePx()).toBeCloseTo(5200, 6);
        // Box still short: wait for it rather than settle on the clamp.
        expect(harness.controller.settleRefusedWrite({ requestedPx: 5267, atRest: false })).toBe(null);

        harness.scroller.setContentHeightPx(6067); // the row's 67px of content, one commit later
        expect(harness.controller.settleRefusedWrite({ requestedPx: 5267, atRest: false })).toBeCloseTo(5267, 6);
        harness.controller.setDistancePx(5267);
        expect(harness.controller.readDistancePx()).toBeCloseTo(5267, 6);
    });

    it('waits out a refusal the range cannot cover, then takes the end of the range', () => {
        const harness = createHarness({ contentHeightPx: 6000, startDistancePx: 500 });
        harness.controller.setDistancePx(5267); // past the end: the engine holds 5200
        // The box is still moving, so the clamp is the engine's arithmetic and not a position —
        // adopting it here is the bug this file exists for.
        expect(harness.controller.settleRefusedWrite({ requestedPx: 5267, atRest: false })).toBe(null);
        // At rest the content simply ends before the request: the range end is where the reader is,
        // and the intent has to follow it there or every later correction starts from a distance the
        // scroller can never hold.
        expect(harness.controller.settleRefusedWrite({ requestedPx: 5267, atRest: true })).toBeCloseTo(5200, 6);
        harness.controller.setDistancePx(5200);
        expect(harness.controller.getRequestedDistancePx()).toBeCloseTo(5200, 6);
    });
});

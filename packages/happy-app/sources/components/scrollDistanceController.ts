// The one piece of state that stops a bottom-anchored list from drifting: the
// distance the scroller was TOLD to be at, kept separately from the distance it
// reports.
//
// Port of the `thread-scroll-layout` controller at the core of Codex's thread
// view. Its rule is that every scroll correction is arithmetic on our own
// number — `distance += delta` — and never a re-derivation from the DOM:
//
//   - A write that the engine partly refuses (fractional `scrollTop`, a range
//     it has not laid out yet, a clamp at either end) is remembered as
//     {requested, actual}. Reads then answer with `requested` while the DOM
//     still reports `actual`.
//   - The record dies the moment the DOM reports something else, which is what
//     a real user scroll does. Until then the rounding error is a value we
//     carry, not a value we accumulate.
//
// Without that, a toggle that reads its target out of the DOM re-imports one
// quantization step per toggle. On a fractional layout (a scaled display, a
// fractional device pixel ratio) those steps share a sign, so they add up: the
// header creeps a pixel at a time and is visibly off after a few dismissals.
export interface ScrollElementLike {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

// The carry is the list's spare room below the content (ChatList.web's
// canvasBottomOffset). Taking a deficit out of it instead of clamping keeps the
// viewport's position in the model exact while the DOM sits at its limit.
export interface ScrollCarryLike {
    getPx(): number;
    setPx(px: number): void;
}

// Only touch a carry this tall: a shorter one is a live measurement, not slack.
const CARRY_TOUCH_MIN_PX = 24;

export function createScrollDistanceController(params: {
    getElement: () => ScrollElementLike | null;
    /** Told the distance the caller must now believe changed (the preserve path only). */
    onDistanceChange: (distancePx: number) => void;
    scheduleMicrotask?: (fn: () => void) => void;
    scheduleFrame?: (fn: () => void) => number;
    cancelFrame?: (handle: number) => void;
}) {
    const { getElement, onDistanceChange } = params;
    const scheduleMicrotask = params.scheduleMicrotask ?? ((fn) => queueMicrotask(fn));
    const scheduleFrame = params.scheduleFrame ?? ((fn) => window.requestAnimationFrame(fn));
    const cancelFrame = params.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));

    // {requested, actual} of the last instant write the engine did not honour
    // exactly. Null means the DOM agrees with us.
    let clamp: { requestedPx: number; actualPx: number } | null = null;
    // The {distance, scrollHeight} pair a layout change is being verified against.
    let preserve: { distancePx: number; scrollHeightPx: number } | null = null;
    let preserveFrame: number | null = null;

    /** What the scroller currently reports, in its own quantized numbers. */
    function readDistancePx(): number {
        const el = getElement();
        return el ? Math.max(0, Math.abs(el.scrollTop)) : 0;
    }

    /**
     * The distance we intended, which is what all correction arithmetic must
     * start from. Falls back to `distancePx` when the DOM has moved on its own.
     */
    function getRequestedDistancePx(): number {
        const actual = readDistancePx();
        return clamp != null && clamp.actualPx === actual ? clamp.requestedPx : actual;
    }

    function writeRaw(distancePx: number) {
        const el = getElement();
        if (!el) return 0;
        const target = Math.max(0, distancePx);
        // column-reverse: 0 is the content bottom, everything above is negative.
        el.scrollTop = target === 0 ? 0 : -target;
        return Math.max(0, Math.abs(el.scrollTop));
    }

    function recordClamp(requestedPx: number, actualPx: number) {
        const el = getElement();
        const atLimit = el != null && (requestedPx <= 0 || requestedPx >= el.scrollHeight - el.clientHeight);
        clamp = el != null && actualPx !== requestedPx && !atLimit ? { requestedPx, actualPx } : null;
    }

    /**
     * Write an absolute distance. Remembering the intent is the whole point:
     * the caller is expected to keep computing from `getRequestedDistancePx()`,
     * not from what this returns.
     */
    function setDistancePx(distancePx: number): number {
        const target = Math.max(0, distancePx);
        const actual = writeRaw(target);
        recordClamp(target, actual);
        return actual;
    }

    /**
     * `distance += delta` — the only way a height change is allowed to move the
     * viewport. A negative result would be clamped away, so the deficit comes
     * out of the carry instead.
     */
    function applyHeightDeltaPx(deltaPx: number, carry: ScrollCarryLike | null) {
        if (deltaPx === 0) return;
        const target = getRequestedDistancePx() + deltaPx;
        if (carry != null && target < 0 && carry.getPx() > CARRY_TOUCH_MIN_PX) {
            carry.setPx(carry.getPx() - target);
        }
        setDistancePx(Math.max(0, target));
    }

    /** The correction for a layout that grew or shrank under a still viewport. */
    function correctionAgainst(snapshot: { distancePx: number; scrollHeightPx: number }): number | null {
        const el = getElement();
        if (el == null) return null;
        const growthPx = el.scrollHeight - snapshot.scrollHeightPx;
        const current = readDistancePx();
        if (growthPx === 0 || current !== snapshot.distancePx) return null;
        return writeRaw(current - growthPx);
    }

    function armPreserveFrame() {
        preserveFrame = scheduleFrame(() => {
            const snapshot = preserve;
            preserve = null;
            preserveFrame = null;
            if (snapshot == null) return;
            const corrected = correctionAgainst(snapshot);
            if (corrected != null) onDistanceChange(corrected);
        });
    }

    /**
     * Called before a commit that changes the content height without changing
     * the distance. Verifies after the layout in a microtask and again on the
     * next frame: if nobody moved the viewport but the scroll range grew or
     * shrank, put the visible content back where it was.
     */
    function preserveScrollPositionForNextLayout() {
        const el = getElement();
        if (el == null || preserve != null) return;
        const snapshot = { distancePx: readDistancePx(), scrollHeightPx: el.scrollHeight };
        preserve = snapshot;
        scheduleMicrotask(() => {
            if (preserve !== snapshot) return;
            if (getElement()?.scrollHeight === snapshot.scrollHeightPx) {
                cancelPreserve();
                return;
            }
            const corrected = correctionAgainst(snapshot);
            if (corrected != null) onDistanceChange(corrected);
        });
        armPreserveFrame();
    }

    function cancelPreserve() {
        preserve = null;
        if (preserveFrame != null) {
            cancelFrame(preserveFrame);
            preserveFrame = null;
        }
    }

    /** Real user input: the DOM is the truth again. */
    function clearIntent() {
        clamp = null;
    }

    return {
        readDistancePx,
        getRequestedDistancePx,
        setDistancePx,
        applyHeightDeltaPx,
        preserveScrollPositionForNextLayout,
        cancelPreserve,
        clearIntent,
    };
}

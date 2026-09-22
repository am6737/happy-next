// The one piece of state that stops a bottom-anchored list from drifting: the
// distance the scroller was TOLD to be at, kept separately from the distance it
// reports.
//
// Port of the `thread-scroll-layout` controller at the core of Codex's thread
// view. Its rule is that every scroll correction is arithmetic on our own
// number — the intent plus a delta the model measured — and never a
// re-derivation from the DOM:
//
//   - A write that the engine partly refuses (fractional `scrollTop`, a range it
//     has not laid out yet, a clamp at either end) is remembered as
//     {requested, actual}. Reads then answer with `requested` while the DOM
//     still reports `actual`.
//   - The record dies the moment the DOM reports something else, which is what a
//     real user scroll does. Until then the rounding error is a value we carry,
//     not a value we accumulate.
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

export function createScrollDistanceController(params: { getElement: () => ScrollElementLike | null }) {
    const { getElement } = params;

    // {requested, actual} of the last write the engine did not honour exactly.
    // Null means the DOM agrees with us.
    let clamp: { requestedPx: number; actualPx: number } | null = null;

    /** What the scroller currently reports, in its own quantized numbers. */
    function readDistancePx(): number {
        const el = getElement();
        return el ? Math.max(0, Math.abs(el.scrollTop)) : 0;
    }

    /**
     * The distance we intended, which is what all correction arithmetic must
     * start from. Falls back to the reported distance once the DOM has moved on
     * its own.
     */
    function getRequestedDistancePx(): number {
        const actual = readDistancePx();
        return clamp != null && clamp.actualPx === actual ? clamp.requestedPx : actual;
    }

    /**
     * Write an absolute distance. Remembering the intent is the whole point: the
     * caller keeps computing from `getRequestedDistancePx()`, never from what
     * this returns.
     */
    function setDistancePx(distancePx: number): number {
        const el = getElement();
        if (!el) return 0;
        const target = Math.max(0, distancePx);
        // column-reverse: 0 is the content bottom, everything above is negative.
        el.scrollTop = target === 0 ? 0 : -target;
        const actual = Math.max(0, Math.abs(el.scrollTop));
        // A write the engine refused at either end of the range is not a rounding
        // to remember — the DOM holds those two offsets exactly.
        const atLimit = target <= 0 || target >= el.scrollHeight - el.clientHeight;
        clamp = actual !== target && !atLimit ? { requestedPx: target, actualPx: actual } : null;
        return actual;
    }

    return { readDistancePx, getRequestedDistancePx, setDistancePx };
}

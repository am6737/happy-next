// The one piece of state that stops a bottom-anchored list from drifting: the
// distance the scroller was TOLD to be at, kept separately from the distance it
// reports.
//
// Port of the `thread-scroll-layout` controller at the core of Codex's thread
// view. Its rule is that every scroll correction is arithmetic on our own
// number — the intent plus a delta the caller measured — and never a
// re-derivation from the DOM:
//
//   - A write is remembered as the distance we asked for, whatever the engine
//     did with it: a fractional `scrollTop`, a range it has not laid out yet, a
//     clamp at either end. Reads answer with the request, so the rounding the
//     engine hands back is a value we carry rather than a value we accumulate.
//   - Only the reader moves that number: `adoptReportedDistancePx` is called
//     when they scrolled by hand. A scroller that moved with nobody asking did
//     not move the reader — a layout that shrank under the viewport clamps the
//     offset itself, and reading that clamp back as where they are is what
//     turned a fold into a jump to the bottom of the conversation.
//   - A refusal is not an answer, but it is not nothing either: the range can
//     be short of the request for exactly one commit (the row a fold opens
//     arrives a frame after the arithmetic that accounted for it), and there
//     the request is simply asked again once the box has caught up. The range
//     end is only taken once the box has stopped moving — at rest, a request
//     past it means the reader is at the end of the content, which is a place
//     and not a refusal. See `settleRefusedWrite`.
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

    // The distance we own. Null until the first write: before that there is
    // nothing of ours to answer with, and the scroller's own number is the truth.
    let intentPx: number | null = null;

    /** What the scroller currently reports, in its own quantized numbers. */
    function readDistancePx(): number {
        const el = getElement();
        return el ? Math.max(0, Math.abs(el.scrollTop)) : 0;
    }

    /**
     * The distance we intended, which is what all correction arithmetic must
     * start from. `readDistancePx` stays the caller's for verification — a write
     * the engine dropped outright is visible there and nowhere else.
     */
    function getRequestedDistancePx(): number {
        return intentPx ?? readDistancePx();
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
        intentPx = target;
        // column-reverse: 0 is the content bottom, everything above is negative.
        el.scrollTop = target === 0 ? 0 : -target;
        return Math.max(0, Math.abs(el.scrollTop));
    }

    /**
     * The reader moved the scroller themselves: whatever it reports is where they
     * are, and the arithmetic starts from there. Nothing else may call this — a
     * clamp is not a scroll.
     */
    function adoptReportedDistancePx(): number {
        intentPx = readDistancePx();
        return intentPx;
    }

    /**
     * What a write the engine refused should be settled at, or null while there
     * is nothing to settle. The caller writes whatever comes back — through
     * `setDistancePx`, so the intent ends up on it.
     */
    function settleRefusedWrite(params: { requestedPx: number; atRest: boolean }): number | null {
        const el = getElement();
        if (!el) return null;
        return resolveRefusedWrite({
            requestedPx: params.requestedPx,
            reportedPx: readDistancePx(),
            maxDistancePx: el.scrollHeight - el.clientHeight,
            atRest: params.atRest,
        });
    }

    return { readDistancePx, getRequestedDistancePx, setDistancePx, adoptReportedDistancePx, settleRefusedWrite };
}

/**
 * The number a refused write should be settled at: the request itself, the end
 * of the range, or null while the refusal is still worth waiting on.
 *
 * A write is refused in two shapes, and they are told apart by the range rather
 * than by the clamp:
 *
 *   - the range covers the request, so the refusal was the box being a frame
 *     behind — ask again, and the line the reader tapped comes back;
 *   - the range does not cover it. Only when the box has stopped moving is that
 *     final: at rest it means the content ends before the request, and the
 *     range end is where the reader is. While the box is still moving it means
 *     nothing at all, and taking the clamp would be the old bug — a momentary
 *     range read back as a position.
 */
export function resolveRefusedWrite(params: {
    requestedPx: number;
    reportedPx: number;
    maxDistancePx: number;
    atRest: boolean;
    tolerancePx?: number;
}): number | null {
    const tolerancePx = params.tolerancePx ?? 1;
    const maxDistancePx = Math.max(0, params.maxDistancePx);
    if (Math.abs(params.reportedPx - params.requestedPx) <= tolerancePx) return null;
    if (params.requestedPx <= maxDistancePx + tolerancePx) return params.requestedPx;
    return params.atRest ? maxDistancePx : null;
}

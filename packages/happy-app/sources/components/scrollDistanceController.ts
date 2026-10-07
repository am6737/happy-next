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
//   - The record lives exactly as long as the scroller still holds what the
//     engine made of that write. The moment a scroll event reports anything
//     else, somebody moved it — the reader's wheel, the engine animating their
//     gesture, a script's smooth scroll, a scrollbar drag — and the reported
//     offset is where the reader now is. No guessing at who moved it: an input
//     timestamp cannot see a script or a smooth scroll still running after its
//     last wheel event, and an intent that outlives those is a correction aimed
//     at a place the reader has already left, i.e. the list yanking back.
//   - Between scroll events, the arithmetic starts from the last distance a
//     scroll event or a write produced, never from a fresh read. A layout that
//     shrinks under the viewport clamps the offset inside the commit, before the
//     scroll event that reports it; the correction runs in that same commit and
//     must start from where the reader was, not from the clamp.
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

    // The last distance a scroll event reported or a write produced. Null until
    // either happens: before that the scroller's own number is the truth.
    let lastDistancePx: number | null = null;
    // A write the engine did not store as asked: what we asked, and what it
    // stored instead. Answers for the stored number for as long as the
    // scroller still holds it.
    let pendingIntent: { requestedPx: number; storedPx: number } | null = null;

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
        const basePx = lastDistancePx ?? readDistancePx();
        if (pendingIntent != null && pendingIntent.storedPx === basePx) return pendingIntent.requestedPx;
        return basePx;
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
        const storedPx = readDistancePx();
        lastDistancePx = storedPx;
        pendingIntent = storedPx === target ? null : { requestedPx: target, storedPx };
        return storedPx;
    }

    /**
     * A scroll event: the scroller reports where it is now. If that is still what
     * our last write left there, the event is the echo of that write and the
     * intent stands; anything else means it moved, and the reported offset is the
     * reader's position from here on. `moved` is false only for that echo.
     */
    function noteScrollEvent(): { distancePx: number; moved: boolean } {
        const reportedPx = readDistancePx();
        const moved = reportedPx !== lastDistancePx;
        if (pendingIntent != null && pendingIntent.storedPx !== reportedPx) pendingIntent = null;
        lastDistancePx = reportedPx;
        return { distancePx: reportedPx, moved };
    }

    /** Take whatever the scroller reports as the reader's position, dropping any intent. */
    function adoptReportedDistancePx(): number {
        pendingIntent = null;
        lastDistancePx = readDistancePx();
        return lastDistancePx;
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

    return { readDistancePx, getRequestedDistancePx, setDistancePx, noteScrollEvent, adoptReportedDistancePx, settleRefusedWrite };
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

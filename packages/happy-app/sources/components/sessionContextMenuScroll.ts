/**
 * The DOM shapes the dismissal rule works on, kept structural so it stays testable without a DOM.
 * Anything with a `contains` — `Node`, `Document` — satisfies it.
 */
export type ScrollTarget = { contains?: (other: unknown) => boolean } | null | undefined;

/**
 * Whether a scroll should dismiss an open session menu.
 *
 * The listener runs on `window` in the capture phase, so it sees every scroll in the document —
 * including the chat pane's own `scrollTop` rewrites, which fire on each streaming update while a
 * session is open. The menu only goes stale when the row it acts on moves with the scroll, so a
 * scroll of a container the row does not sit in (the chat pane, another list) must not close it.
 */
export function shouldDismissSessionMenuOnScroll(
    scrollTarget: ScrollTarget,
    anchor: ScrollTarget,
): boolean {
    // No row to attribute the scroll to: the menu hangs at a fixed screen point, so any scroll
    // may have moved it out from under the cursor.
    if (!anchor) {
        return true;
    }
    // Same for a scroll target we cannot place in the document.
    if (!scrollTarget || typeof scrollTarget.contains !== 'function') {
        return true;
    }
    return scrollTarget.contains(anchor);
}

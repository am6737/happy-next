/** The gap between the composer and the keyboard — shared by `AgentContentView` and `ChatList`. */
export const COMPOSER_MARGIN = 8;

/**
 * How far the floating composer (iOS 26) pads itself above the bottom of the screen with the keyboard
 * down. It floats into the home-indicator area rather than stacking the whole inset under its card:
 * the card's own bottom margin (8) plus this leaves it `COMPOSER_MARGIN` closer to the edge.
 * The keyboard offsets are taken from this same number, so the gap above the keyboard is unchanged.
 */
export function floatingComposerBottomInset(safeAreaBottom: number): number {
    return Math.max(0, safeAreaBottom - COMPOSER_MARGIN);
}

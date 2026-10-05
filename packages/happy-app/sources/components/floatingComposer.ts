import { liquidGlassAvailable } from './GlassSurface';

/** The gap between the composer and the keyboard — shared by `AgentContentView` and the chat lists. */
export const COMPOSER_MARGIN = 8;

/**
 * Whether chat screens float their composer over the list as a glass card (iOS 26, not Catalyst):
 * the list runs to the bottom of the screen and iOS draws the soft scroll edge under the composer.
 * Everywhere else the composer stacks below the list.
 */
export const floatingComposerAvailable = liquidGlassAvailable;

/**
 * Screen options for a chat screen with a floating composer, spread after `softHeaderOptions`:
 * those hide the bottom scroll edge, which is exactly the one drawn under the composer.
 */
export const floatingComposerScreenOptions = floatingComposerAvailable
    ? ({ scrollEdgeEffects: { top: 'soft', bottom: 'soft' } } as const)
    : {};

/**
 * How far the floating composer (iOS 26) pads itself above the bottom of the screen with the keyboard
 * down. It floats into the home-indicator area rather than stacking the whole inset under its card:
 * the card's own bottom margin (8) plus this leaves it `COMPOSER_MARGIN` closer to the edge.
 * The keyboard offsets are taken from this same number, so the gap above the keyboard is unchanged.
 */
export function floatingComposerBottomInset(safeAreaBottom: number): number {
    return Math.max(0, safeAreaBottom - COMPOSER_MARGIN);
}

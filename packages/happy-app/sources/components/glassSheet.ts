import { liquidGlassAvailable } from './GlassSurface';

/*
 * The bottom sheets (voice detail, session preview, duplicate session) on iOS 26: a glass card
 * floating clear of the screen's edges, with the round corners of the system's own sheets.
 *
 * Glass does not render in a view that is not fully opaque, so the card is not faded in with the
 * backdrop: it slides up by its own height on a nearly critically damped spring (the action menu's),
 * over a lighter dim that would otherwise also darken the glass. Elsewhere the sheets stay solid.
 */

/** The gap between the card and the screen's sides and bottom (above the home indicator). */
export const GLASS_SHEET_MARGIN = 8;
export const GLASS_SHEET_RADIUS = 32;
export const SHEET_SLIDE_SPRING = { damping: 32, stiffness: 300 };
export const SHEET_BACKDROP_OPACITY = liquidGlassAvailable ? 0.2 : 0.5;
/** A fill for controls on the glass: a solid one would cover it, this only tints it. */
export const GLASS_SHEET_FILL = 'rgba(120, 120, 128, 0.16)';

/** Padding of the frame around the card, which sits into the home-indicator area by the margin. */
export function glassSheetFramePadding(safeAreaBottom: number) {
    return {
        padding: GLASS_SHEET_MARGIN,
        paddingBottom: Math.max(GLASS_SHEET_MARGIN, safeAreaBottom - GLASS_SHEET_MARGIN),
    };
}

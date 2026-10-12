/** One pass of the light, from just before the text to just past it. About the pace of 2200ms across the text alone. */
export const SWEEP_MS = 2800;
/** How long the text rests, back to its dim colour, between the light leaving and the next pass. */
export const PAUSE_MS = 600;
/**
 * How far the text holds back between passes of the light. The band adds nothing to it away from
 * its centre, so the text rests at the same strength wherever the light is.
 */
export const BASE_ALPHA = 0.54;

/** The same colour, see-through, so the row behind it shows through and the glyphs read as dim. */
export function dimmed(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const n = Number.parseInt(full, 16);
    if (Number.isNaN(n)) return hex;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

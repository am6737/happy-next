export interface TerminalBarBottomPaddingInput {
    /** The height the keyboard is taking from the bottom of the screen; 0 while it is down. */
    keyboardHeight: number;
    safeAreaBottom: number;
}

/**
 * How much room the key bar has to leave below its buttons.
 *
 * The bar sits on the bottom edge of the screen, which means two different things can be under it:
 * the home indicator, and the keyboard. Those are alternatives rather than additions, because a
 * platform reports the keyboard's height from that same bottom edge — it already covers the strip the
 * indicator lives in. Adding the two would lift the bar a home indicator's worth of pixels off the
 * top of the keyboard; taking the taller of them leaves the buttons sitting on it.
 */
export function resolveTerminalBarBottomPadding(input: TerminalBarBottomPaddingInput): number {
    return Math.max(input.keyboardHeight, input.safeAreaBottom, 0);
}

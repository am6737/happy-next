import { describe, expect, it } from 'vitest';
import { resolveTerminalBarBottomPadding } from './terminalBarPadding';

const HOME_INDICATOR = 34;
const KEYBOARD = 336;

describe('resolveTerminalBarBottomPadding', () => {
    it('leaves room for the home indicator while the keyboard is down', () => {
        expect(
            resolveTerminalBarBottomPadding({ keyboardHeight: 0, safeAreaBottom: HOME_INDICATOR }),
        ).toBe(HOME_INDICATOR);
    });

    // The keyboard's height is measured from the bottom of the screen and so
    // already contains the indicator's strip: the bar must not add both, which
    // would leave the buttons a home indicator above the keyboard.
    it('sits on the keyboard rather than an indicator above it', () => {
        expect(
            resolveTerminalBarBottomPadding({ keyboardHeight: KEYBOARD, safeAreaBottom: HOME_INDICATOR }),
        ).toBe(KEYBOARD);
    });

    it('takes nothing from a screen with neither', () => {
        expect(
            resolveTerminalBarBottomPadding({ keyboardHeight: 0, safeAreaBottom: 0 }),
        ).toBe(0);
    });
});

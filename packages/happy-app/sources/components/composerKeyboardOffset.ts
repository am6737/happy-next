import * as React from 'react';

/**
 * How far below the keyboard's top the composer's bottom edge rests once the keyboard is up — the
 * `opened` offset `AgentContentView` hands to `KeyboardDock` / `KeyboardStickyView`.
 *
 * Both lift the composer without touching its layout (UIKit's `keyboardLayoutGuide`, or a transform),
 * so `measureInWindow` inside it keeps reporting the keyboard-down position. A popover anchored to
 * something in the composer subtracts `keyboardHeight - offset` to land where the composer really is.
 * `null` where the composer is lifted by layout instead (nothing to correct for).
 */
export const ComposerKeyboardOffsetContext = React.createContext<number | null>(null);

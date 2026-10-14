import * as React from 'react';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Lets the text field of a floating composer animate its height while the chat list follows it
 * frame by frame. `AgentContentView` floats the composer over the list and tells the list how
 * tall it is; measured with `onLayout` alone that height reaches the list a frame or more after
 * the composer has moved, and jumps to the end of an animation at once. The field instead writes
 * the height it is drawn at to `height` on the UI thread and reports the height it was laid out at
 * through `onLayout`, so the composer's height is its laid-out height with the field's share
 * swapped for the drawn one.
 *
 * `null` where the composer does not float over the list: the list then sits above the composer
 * and is resized by layout, so the field does not animate.
 */
export interface ComposerInputHeight {
    /** The height the field is drawn at, animated on the UI thread. */
    height: SharedValue<number>;
    /** The height the field is animating to (its text input's own height). */
    target: SharedValue<number>;
    /** The height the field was last laid out at (0 once it unmounts). */
    onLayout: (height: number) => void;
}

export const ComposerInputHeightContext = React.createContext<ComposerInputHeight | null>(null);

import * as React from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * The keyboard events that mark the start of a move in and out.
 *
 * iOS reports the keyboard before it animates in and before it animates out; Android only reports it
 * after the fact. The event names differ per platform on purpose here rather than listening to all
 * four: a `will`/`did` pair for the same change would fire twice, and anything reacting to the first
 * one would move against a keyboard that has not moved yet.
 */
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** Whether the software keyboard is up. */
export function useKeyboardVisible(): boolean {
    const [visible, setVisible] = React.useState(false);

    React.useEffect(() => {
        const show = Keyboard.addListener(SHOW_EVENT, () => setVisible(true));
        const hide = Keyboard.addListener(HIDE_EVENT, () => setVisible(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    return visible;
}

/**
 * How much height the keyboard is taking from the bottom of the screen; 0 while it is down.
 *
 * The counterpart to `useKeyboardVisible` for a layout that has to hand the keyboard its room — a bar
 * at the bottom of a screen, or a terminal above one that resizes its shell to match. The height is
 * read from the same event that raises the flag, so the room comes back the moment the keyboard
 * starts to leave rather than once it has finished: holding the layout until the keyboard is gone
 * leaves a terminal, and the shell behind it, arriving a beat late.
 *
 * `react-native-keyboard-controller`'s `useKeyboardState` is not used for this: it raises its flag on
 * a show but lowers it on the end of a hide, which is that lateness exactly.
 */
export function useKeyboardSpace(): number {
    const [height, setHeight] = React.useState(0);

    React.useEffect(() => {
        const show = Keyboard.addListener(SHOW_EVENT, (event: KeyboardEvent) => {
            setHeight(event.endCoordinates.height);
        });
        // A hide event carries the keyboard's own frame on its way off the bottom of the screen, which
        // is not the room it still takes, so the space is simply gone.
        const hide = Keyboard.addListener(HIDE_EVENT, () => setHeight(0));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    return height;
}

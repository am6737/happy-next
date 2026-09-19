import * as React from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the software keyboard is up.
 *
 * iOS reports the keyboard before it animates in and before it animates out; Android only reports it
 * after the fact. The event names differ per platform on purpose here rather than listening to all
 * four: a `will`/`did` pair for the same change would flip the flag twice, and anything reacting to
 * the first flip would animate against a keyboard that has not moved yet.
 */
export function useKeyboardVisible(): boolean {
    const [visible, setVisible] = React.useState(false);

    React.useEffect(() => {
        const show = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            () => setVisible(true)
        );
        const hide = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => setVisible(false)
        );
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    return visible;
}

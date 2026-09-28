import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from '@/components/floatingComposer';

/**
 * Style for controls pinned to the bottom of a chat list (scroll-to-bottom button, hints) when the
 * list scrolls in a `ChatScrollView`.
 *
 * That list's frame no longer shrinks for the keyboard, so these controls would end up behind it;
 * this moves them with the keyboard the same way `KeyboardStickyView` moves the composer. A floating
 * composer covers the list's bottom as well, so with `composerInset` they also sit above it.
 * `enabled` false (the list is not in a `ChatScrollView`) leaves them where they are.
 */
export function useChatOverlayStyle(enabled: boolean, composerInset?: SharedValue<number>) {
    const safeArea = useSafeAreaInsets();
    // Where the composer's padding ends above the screen's bottom, which its keyboard offset is
    // measured from: the floating composer sits lower than the stacked one.
    const keyboardBottomInset = composerInset ? floatingComposerBottomInset(safeArea.bottom) : safeArea.bottom;
    const { height, progress } = useReanimatedKeyboardAnimation();
    return useAnimatedStyle(() => (enabled ? {
        transform: [{
            translateY: height.value
                + (keyboardBottomInset - COMPOSER_MARGIN) * progress.value
                - (composerInset?.value ?? 0),
        }],
    } : {}), [enabled, keyboardBottomInset, composerInset]);
}

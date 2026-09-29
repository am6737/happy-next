import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from '@/components/floatingComposer';

/**
 * What the two styles below need to work out how far the keyboard and a floating composer cover a
 * chat list's bottom (its frame no longer shrinks for either when it scrolls in a `ChatScrollView`).
 * The keyboard's share is measured the way `KeyboardStickyView` moves the composer.
 */
function useChatBottomCover(composerInset?: SharedValue<number>) {
    const safeArea = useSafeAreaInsets();
    // Where the composer's padding ends above the screen's bottom, which its keyboard offset is
    // measured from: the floating composer sits lower than the stacked one.
    const keyboardBottomInset = composerInset ? floatingComposerBottomInset(safeArea.bottom) : safeArea.bottom;
    const { height, progress } = useReanimatedKeyboardAnimation();
    return { height, progress, keyboardBottomInset };
}

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
    const { height, progress, keyboardBottomInset } = useChatBottomCover(composerInset);
    return useAnimatedStyle(() => (enabled ? {
        transform: [{
            translateY: height.value
                + (keyboardBottomInset - COMPOSER_MARGIN) * progress.value
                - (composerInset?.value ?? 0),
        }],
    } : {}), [enabled, keyboardBottomInset, composerInset]);
}

/**
 * The same cover as `useChatOverlayStyle`, as the `bottom` of an absolutely positioned view over the
 * list: it ends where the keyboard and a floating composer begin, so content centered in it stays
 * centered in what is left visible. `enabled` false (the list's frame already shrinks) leaves it at
 * the list's bottom.
 */
export function useChatVisibleAreaStyle(enabled: boolean, composerInset?: SharedValue<number>) {
    const { height, progress, keyboardBottomInset } = useChatBottomCover(composerInset);
    return useAnimatedStyle(() => ({
        bottom: enabled
            ? -height.value
                - (keyboardBottomInset - COMPOSER_MARGIN) * progress.value
                + (composerInset?.value ?? 0)
            : 0,
    }), [enabled, keyboardBottomInset, composerInset]);
}

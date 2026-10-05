import * as React from 'react';
import { View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/** Keeps an empty-state view centered in the visible chat area while the composer follows the keyboard. */
export const KeyboardCenteredEmpty = React.memo(({ children, composerInset }: {
    children: React.ReactNode;
    /** The height of a composer floating over the list: the visible area ends at its top. */
    composerInset?: SharedValue<number>;
}) => {
    const { height } = useReanimatedKeyboardAnimation();
    const animatedStyle = useAnimatedStyle(() => ({
        // KeyboardChatScrollView already lifts the list by the keyboard travel, and by a floating
        // composer's height (its extra content padding). Give back half of both so the empty
        // state's center ends up halfway up the area left between the header and the composer.
        transform: [{ translateY: -height.value * 0.5 + (composerInset?.value ?? 0) * 0.5 }],
    }), [composerInset]);
    return (
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                {children}
            </View>
        </Animated.View>
    );
});
KeyboardCenteredEmpty.displayName = 'KeyboardCenteredEmpty';

import * as React from 'react';
import { View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

/** Keeps an empty-state view centered in the visible chat area while the composer follows the keyboard. */
export const KeyboardCenteredEmpty = React.memo(({ children }: { children: React.ReactNode }) => {
    const { height } = useReanimatedKeyboardAnimation();
    const animatedStyle = useAnimatedStyle(() => ({
        // KeyboardChatScrollView already lifts the list by the keyboard travel. Compensate
        // half of that movement so the empty state's center ends up halfway up.
        transform: [{ translateY: -height.value * 0.5 }],
    }), []);
    return (
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                {children}
            </View>
        </Animated.View>
    );
});
KeyboardCenteredEmpty.displayName = 'KeyboardCenteredEmpty';

import * as React from 'react';
import { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

const HEIGHT_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

const stylesheet = StyleSheet.create({
    container: {
        overflow: 'hidden',
    },
    // Lays the content out at its own height while the container animates toward it.
    measuredContent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
});

interface AnimatedHeightProps {
    children: React.ReactNode;
    /** The clipping box: background, corners, margins. */
    style?: StyleProp<ViewStyle>;
    /** The content box, measured for the height: padding, gaps, a maxHeight. */
    contentStyle?: StyleProp<ViewStyle>;
}

/**
 * A box that animates its height when its content grows or shrinks, instead of jumping to it.
 * The first height is taken as is.
 */
export const AnimatedHeight = React.memo(({ children, style, contentStyle }: AnimatedHeightProps) => {
    const styles = stylesheet;
    // 0 until the content is first measured.
    const height = useSharedValue(0);
    const heightStyle = useAnimatedStyle(() => (height.value > 0 ? { height: height.value } : {}));
    const handleLayout = React.useCallback((e: LayoutChangeEvent) => {
        const next = e.nativeEvent.layout.height;
        height.value = height.value > 0 ? withTiming(next, HEIGHT_TIMING) : next;
    }, [height]);

    return (
        <Animated.View style={[styles.container, style, heightStyle]}>
            <Animated.View style={[styles.measuredContent, contentStyle]} onLayout={handleLayout}>
                {children}
            </Animated.View>
        </Animated.View>
    );
});
AnimatedHeight.displayName = 'AnimatedHeight';

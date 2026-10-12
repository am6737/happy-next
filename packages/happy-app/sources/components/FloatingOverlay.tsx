import * as React from 'react';
import { NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent, ScrollView } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { computeScrollIntoView } from './scrollIntoView';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    // Set apart from the page by its own fill alone, without border or shadow.
    container: {
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.floatingOverlay.background,
    },
    // Lays the content out at its own height (up to maxHeight) while the container animates toward it.
    measuredContent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
}));

const HEIGHT_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

interface FloatingOverlayProps {
    children: React.ReactNode;
    maxHeight?: number;
    showScrollIndicator?: boolean;
    /**
     * Defaults to true. When false the overlay is only the clamped, rounded surface and does not scroll:
     * the children manage their own scrolling, so fixed rows (tabs, footers) stay in place.
     */
    scrollable?: boolean;
    keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
    /**
     * Only with `scrollable={false}`: animates the overlay's height when its content grows or shrinks
     * (switching tabs, a row appearing) instead of jumping to it.
     */
    animateHeight?: boolean;
    /**
     * When provided (together with `itemHeight`), the overlay keeps the item at
     * `selectedIndex` scrolled into view as it changes — used for keyboard
     * navigation of lists that overflow `maxHeight`.
     */
    selectedIndex?: number;
    /** Fixed height of each row, required for `selectedIndex` scroll-into-view. */
    itemHeight?: number;
}

export const FloatingOverlay = React.memo((props: FloatingOverlayProps) => {
    const styles = stylesheet;
    const {
        children,
        maxHeight = 240,
        showScrollIndicator = false,
        scrollable = true,
        keyboardShouldPersistTaps = 'handled',
        selectedIndex,
        itemHeight,
        animateHeight = false,
    } = props;

    const scrollRef = React.useRef<ScrollView>(null);
    const scrollYRef = React.useRef(0);
    const viewportHeightRef = React.useRef(maxHeight);

    React.useEffect(() => {
        if (selectedIndex === undefined || itemHeight === undefined) {
            return;
        }
        const nextY = computeScrollIntoView({
            selectedIndex,
            itemHeight,
            currentScrollY: scrollYRef.current,
            viewportHeight: viewportHeightRef.current || maxHeight,
        });
        if (nextY !== null) {
            scrollRef.current?.scrollTo({ y: nextY, animated: true });
        }
    }, [selectedIndex, itemHeight, maxHeight]);

    // 0 until the content is first measured; the first height is taken as is, later ones animate.
    const contentHeight = useSharedValue(0);
    const heightStyle = useAnimatedStyle(() => (contentHeight.value > 0 ? { height: contentHeight.value } : {}));
    const handleContentLayout = React.useCallback((e: LayoutChangeEvent) => {
        const height = e.nativeEvent.layout.height;
        contentHeight.value = contentHeight.value > 0 ? withTiming(height, HEIGHT_TIMING) : height;
    }, [contentHeight]);

    if (!scrollable) {
        if (animateHeight) {
            return (
                <Animated.View style={[styles.container, heightStyle]}>
                    <Animated.View style={[styles.measuredContent, { maxHeight }]} onLayout={handleContentLayout}>
                        {children}
                    </Animated.View>
                </Animated.View>
            );
        }
        return (
            <Animated.View style={[styles.container, { maxHeight }]}>
                {children}
            </Animated.View>
        );
    }

    return (
        <Animated.View style={[styles.container, { maxHeight }]}>
            <Animated.ScrollView
                ref={scrollRef}
                style={{ maxHeight }}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                showsVerticalScrollIndicator={showScrollIndicator}
                scrollEventThrottle={16}
                onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    scrollYRef.current = e.nativeEvent.contentOffset.y;
                }}
                onLayout={(e: LayoutChangeEvent) => {
                    viewportHeightRef.current = e.nativeEvent.layout.height;
                }}
            >
                {children}
            </Animated.ScrollView>
        </Animated.View>
    );
});
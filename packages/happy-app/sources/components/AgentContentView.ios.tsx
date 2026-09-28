import * as React from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollEdgeElementContainer } from './ScrollEdgeElementContainer';
import { KeyboardDock } from './KeyboardDock';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from './floatingComposer';


interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    betweenContentAndInput?: React.ReactNode | null;
    /** Use the demo-style flex-column layout for chat screens. */
    safeAreaLayout?: boolean;
    /**
     * Float the composer over the content instead of stacking it below: the content runs to the
     * bottom of the screen and scrolls under the composer, which iOS 26 marks with the soft scroll
     * edge effect. The content has to keep its last rows clear of the composer itself — its height
     * is written to `composerHeight` for that.
     */
    floatingInput?: boolean;
    composerHeight?: SharedValue<number>;
    /**
     * Let UIKit lift the floating composer over the keyboard (`KeyboardDock`) rather than a
     * transform from JS, so the soft scroll edge under it moves with it. Being tried on the session
     * screen before it replaces `KeyboardStickyView` everywhere.
     */
    keyboardDock?: boolean;
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({ input, content, placeholder, betweenContentAndInput, safeAreaLayout = false, floatingInput = false, composerHeight, keyboardDock = false }) => {
    const safeArea = useSafeAreaInsets();
    const { height } = useReanimatedKeyboardAnimation();
    const placeholderVisibleAreaStyle = useAnimatedStyle(() => ({
        // Keyboard controller reports iOS keyboard height as a negative offset here.
        // Keep empty states centered in the visible area above the keyboard (and, when the
        // composer floats over the content, above the composer too).
        bottom: Math.max(0, -height.value) + (floatingInput ? composerHeight?.value ?? 0 : 0),
    }), [floatingInput, composerHeight]);

    if (floatingInput) {
        const bottomInset = floatingComposerBottomInset(safeArea.bottom);
        const onComposerLayout = (event: LayoutChangeEvent) => {
            if (composerHeight) {
                composerHeight.value = event.nativeEvent.layout.height;
            }
        };
        return (
            <View style={styles.root}>
                {content && (
                    <View style={StyleSheet.absoluteFillObject}>
                        {content}
                    </View>
                )}
                {placeholder && (
                    <Animated.ScrollView
                        style={[StyleSheet.absoluteFillObject, placeholderVisibleAreaStyle]}
                        contentContainerStyle={styles.placeholderContent}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </Animated.ScrollView>
                )}
                {keyboardDock && KeyboardDock ? (
                    <KeyboardDock
                        keyboardOffset={Math.max(0, bottomInset - COMPOSER_MARGIN)}
                        style={[styles.floatingComposer, { paddingBottom: bottomInset }]}
                        onLayout={onComposerLayout}
                    >
                        {betweenContentAndInput}
                        {input}
                    </KeyboardDock>
                ) : (
                    <KeyboardStickyView offset={{ opened: bottomInset - COMPOSER_MARGIN }} style={styles.floatingComposer}>
                        <ScrollEdgeElementContainer
                            edge="bottom"
                            style={{ paddingBottom: bottomInset }}
                            onLayout={onComposerLayout}
                        >
                            {betweenContentAndInput}
                            {input}
                        </ScrollEdgeElementContainer>
                    </KeyboardStickyView>
                )}
            </View>
        );
    }

    if (!safeAreaLayout) {
        return (
            <View style={styles.legacyRoot}>
                <View style={styles.legacyContent}>
                    {content && (
                        <View style={StyleSheet.absoluteFillObject}>
                            {content}
                        </View>
                    )}
                    {placeholder && (
                        <Animated.ScrollView
                            style={[StyleSheet.absoluteFillObject, placeholderVisibleAreaStyle]}
                            contentContainerStyle={styles.placeholderContent}
                            keyboardShouldPersistTaps="handled"
                            alwaysBounceVertical={false}
                        >
                            {placeholder}
                        </Animated.ScrollView>
                    )}
                </View>
                <KeyboardStickyView offset={{ opened: safeArea.bottom }}>
                    {betweenContentAndInput}
                    {input}
                </KeyboardStickyView>
            </View>
        );
    }

    return (
        <SafeAreaView edges={['bottom']} style={styles.root}>
            <View style={styles.contentArea}>
                {content}
                {placeholder && (
                    <Animated.ScrollView
                        style={[StyleSheet.absoluteFillObject, placeholderVisibleAreaStyle]}
                        contentContainerStyle={styles.placeholderContent}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </Animated.ScrollView>
                )}
            </View>
            <KeyboardStickyView offset={{ opened: safeArea.bottom - COMPOSER_MARGIN }}>
                {betweenContentAndInput}
                {input}
            </KeyboardStickyView>
        </SafeAreaView>
    );
});

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    contentArea: {
        flex: 1,
        minHeight: 0,
    },
    legacyRoot: {
        flexBasis: 0,
        flexGrow: 1,
    },
    legacyContent: {
        flexBasis: 0,
        flexGrow: 1,
    },
    floatingComposer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
    },
    placeholderContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

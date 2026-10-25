import * as React from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardDock, type KeyboardDockRef } from './KeyboardDock';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from './floatingComposer';
import { ComposerKeyboardOffsetContext } from './composerKeyboardOffset';
import { ComposerInputHeightContext, type ComposerInputHeight } from './composerInputHeight';


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
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({ input, content, placeholder, betweenContentAndInput, safeAreaLayout = false, floatingInput = false, composerHeight }) => {
    const safeArea = useSafeAreaInsets();
    const { height } = useReanimatedKeyboardAnimation();
    const placeholderVisibleAreaStyle = useAnimatedStyle(() => ({
        // Keyboard controller reports iOS keyboard height as a negative offset here.
        // Keep empty states centered in the visible area above the keyboard (and, when the
        // composer floats over the content, above the composer too).
        bottom: Math.max(0, -height.value) + (floatingInput ? composerHeight?.value ?? 0 : 0),
    }), [floatingInput, composerHeight]);

    // The composer's height is its laid-out height with its text field's share swapped for the
    // height the field is drawn at, so the list follows the field frame by frame as it grows (see
    // `ComposerInputHeightContext`). A shrinking field hands the list its final height at once:
    // it shrinks on send, just as the sent prompt lands and the list animates to the end, and
    // the list moved along with the field too would fight that scroll frame by frame. Until the
    // field has been measured (drawn height 0) its laid-out share stands.
    const laidOut = React.useRef({ composer: 0, input: 0 });
    const composerBaseHeight = useSharedValue(0);
    const inputLaidOutHeight = useSharedValue(0);
    const inputHeight = useSharedValue(0);
    const inputTargetHeight = useSharedValue(0);
    const freeze = useSharedValue(false);
    const sendShrinkListeners = React.useRef(new Set<(composerHeight: number | null) => void>());
    const dockRef = React.useRef<KeyboardDockRef>(null);
    const composerInputHeight = React.useMemo<ComposerInputHeight>(() => ({
        height: inputHeight,
        target: inputTargetHeight,
        onLayout: (height) => {
            laidOut.current.input = height;
            composerBaseHeight.value = laidOut.current.composer - height;
            inputLaidOutHeight.value = height;
        },
        freeze,
        prepareSendShrink: () => {
            const dock = dockRef.current;
            if (typeof dock?.prepareSendShrink !== 'function') return false;
            dock.prepareSendShrink().catch(() => {});
            return true;
        },
        expectSendShrink: (inputHeight) => {
            const height = inputHeight === null ? null : composerBaseHeight.value + inputHeight;
            sendShrinkListeners.current.forEach((listener) => listener(height));
        },
        onSendShrinkExpected: (listener) => {
            sendShrinkListeners.current.add(listener);
            return () => {
                sendShrinkListeners.current.delete(listener);
            };
        },
    }), [composerBaseHeight, inputLaidOutHeight, inputHeight, inputTargetHeight, freeze]);
    useAnimatedReaction(
        () => composerBaseHeight.value + (inputHeight.value > 0
            ? Math.min(inputHeight.value, inputTargetHeight.value)
            : inputLaidOutHeight.value),
        (height) => {
            if (composerHeight) {
                composerHeight.value = height;
            }
        },
        [composerHeight],
    );

    if (floatingInput) {
        const bottomInset = floatingComposerBottomInset(safeArea.bottom);
        const onComposerLayout = (event: LayoutChangeEvent) => {
            laidOut.current.composer = event.nativeEvent.layout.height;
            composerBaseHeight.value = laidOut.current.composer - laidOut.current.input;
        };
        return (
            <ComposerInputHeightContext.Provider value={composerInputHeight}>
            <ComposerKeyboardOffsetContext.Provider value={KeyboardDock ? Math.max(0, bottomInset - COMPOSER_MARGIN) : bottomInset - COMPOSER_MARGIN}>
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
                {/* UIKit lifts the dock over the keyboard itself, so the soft edge under it moves with it. */}
                {KeyboardDock ? (
                    <KeyboardDock
                        ref={dockRef}
                        keyboardOffset={Math.max(0, bottomInset - COMPOSER_MARGIN)}
                        style={[styles.floatingComposer, { paddingBottom: bottomInset }]}
                        onLayout={onComposerLayout}
                    >
                        {betweenContentAndInput}
                        {input}
                    </KeyboardDock>
                ) : (
                    <KeyboardStickyView offset={{ opened: bottomInset - COMPOSER_MARGIN }} style={styles.floatingComposer}>
                        <View style={{ paddingBottom: bottomInset }} onLayout={onComposerLayout}>
                            {betweenContentAndInput}
                            {input}
                        </View>
                    </KeyboardStickyView>
                )}
            </View>
            </ComposerKeyboardOffsetContext.Provider>
            </ComposerInputHeightContext.Provider>
        );
    }

    if (!safeAreaLayout) {
        return (
            <ComposerKeyboardOffsetContext.Provider value={safeArea.bottom}>
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
            </ComposerKeyboardOffsetContext.Provider>
        );
    }

    return (
        <ComposerKeyboardOffsetContext.Provider value={safeArea.bottom - COMPOSER_MARGIN}>
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
        </ComposerKeyboardOffsetContext.Provider>
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

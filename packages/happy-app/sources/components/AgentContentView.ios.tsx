import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const COMPOSER_MARGIN = 8;

interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    betweenContentAndInput?: React.ReactNode | null;
    /** Use the demo-style flex-column layout for chat screens. */
    safeAreaLayout?: boolean;
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({ input, content, placeholder, betweenContentAndInput, safeAreaLayout = false }) => {
    const safeArea = useSafeAreaInsets();
    const { height } = useReanimatedKeyboardAnimation();
    const placeholderVisibleAreaStyle = useAnimatedStyle(() => ({
        // Keyboard controller reports iOS keyboard height as a negative offset here.
        // Keep empty states centered in the visible area above the keyboard.
        bottom: Math.max(0, -height.value),
    }), []);

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
    placeholderContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

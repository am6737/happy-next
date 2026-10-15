import { useHeaderHeight } from '@/utils/responsive';
import * as React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SharedValue } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { ComposerKeyboardOffsetContext } from './composerKeyboardOffset';

interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    betweenContentAndInput?: React.ReactNode | null;
    /** Use the safe-area chat layout (Android here; web keeps the padded layout below). */
    safeAreaLayout?: boolean;
    floatingInput?: boolean;
    composerHeight?: SharedValue<number>;
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo((props) => {
    if (props.safeAreaLayout && Platform.OS === 'android') {
        return <SafeAreaContentView {...props} />;
    }
    return <PaddedContentView {...props} />;
});

/**
 * The chat layout iOS uses (`AgentContentView.ios.tsx`): the composer rides the keyboard in
 * `KeyboardStickyView` and the list lifts its content natively (`ChatScrollView`), both on the UI
 * thread and frame by frame with the keyboard. Resizing the screen for the keyboard instead goes
 * through JS state that only changes once the keyboard has shown or hidden, so the composer jumped
 * there in one step, and back only after the keyboard was fully down.
 */
const SafeAreaContentView = React.memo(({ input, content, placeholder, betweenContentAndInput }: AgentContentViewProps) => {
    const safeArea = useSafeAreaInsets();
    const { theme } = useUnistyles();
    // Rests on the keyboard, as the comment screens' composer does on Android; `ChatScrollView`
    // lifts the list by the same amount (its Android `keyboardOffset`).
    const keyboardOffset = safeArea.bottom;
    return (
        <ComposerKeyboardOffsetContext.Provider value={keyboardOffset}>
            <SafeAreaView edges={['bottom']} style={styles.root}>
                <View style={styles.contentArea}>
                    {content}
                    {placeholder && (
                        <ScrollView
                            style={StyleSheet.absoluteFillObject}
                            contentContainerStyle={styles.placeholderContent}
                            keyboardShouldPersistTaps="handled"
                            alwaysBounceVertical={false}
                        >
                            {placeholder}
                        </ScrollView>
                    )}
                </View>
                {/* Android's status row sits outside the input card; its moving backplate must
                    also cover the row and surrounding spacing so the list cannot show through. */}
                <KeyboardStickyView offset={{ opened: keyboardOffset }} style={{ backgroundColor: theme.colors.surface }}>
                    {betweenContentAndInput}
                    {input}
                </KeyboardStickyView>
            </SafeAreaView>
        </ComposerKeyboardOffsetContext.Provider>
    );
});

const PaddedContentView = React.memo(({ input, content, placeholder, betweenContentAndInput }: AgentContentViewProps) => {
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const state = useKeyboardState();
    return (
        <View style={{ flexBasis:0, flexGrow:1, paddingBottom: state.isVisible ? state.height - safeArea.bottom : 0 }}>
            <View style={{ flexBasis:0, flexGrow:1 }}>
                {content && (
                    <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
                        {content}
                    </View>
                )}
                {placeholder && (
                    <ScrollView
                        style={[{ position: 'absolute', top: safeArea.top + headerHeight, left: 0, right: 0, bottom: 0 }]}
                        contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </ScrollView>
                )}
            </View>
            <View>
                {betweenContentAndInput}
                {input}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    contentArea: {
        flex: 1,
        minHeight: 0,
        // The list is translated up while the keyboard moves (`ChatScrollView`), and Android
        // draws children past their parent's bounds, over the header above.
        overflow: 'hidden',
    },
    placeholderContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

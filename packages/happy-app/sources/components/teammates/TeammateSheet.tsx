import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { KIT_PAGE_PADDING } from './kit';

export { SheetTextInput } from './kit';

/** Ref plus open/close helpers for one sheet. */
export function useTeammateSheet() {
    const ref = React.useRef<BottomSheetModal>(null);
    const present = React.useCallback(() => ref.current?.present(), []);
    const dismiss = React.useCallback(() => ref.current?.dismiss(), []);
    return { ref, present, dismiss };
}

/**
 * Bottom sheet used by every Agent sub-editor: a title, a "Done" button and scrollable content.
 * `size="auto"` fits the content; `size="large"` is for long text such as instructions.
 */
export const TeammateSheet = React.forwardRef<BottomSheetModal, {
    title: string; size?: 'auto' | 'large'; onDismiss?: () => void; children: React.ReactNode;
}>(function TeammateSheet({ title, size = 'auto', onDismiss, children }, ref) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const close = () => { if (ref && typeof ref === 'object') ref.current?.dismiss(); };
    const renderBackdrop = React.useCallback(
        (props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
        [],
    );
    const large = size === 'large';
    return (
        <BottomSheetModal
            ref={ref}
            snapPoints={large ? ['92%'] : undefined}
            enableDynamicSizing={!large}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            backdropComponent={renderBackdrop}
            onDismiss={onDismiss}
            backgroundStyle={{ backgroundColor: theme.colors.surface }}
            handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
        >
            <View style={styles.header}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.done')} hitSlop={10} onPress={close}>
                    <Text style={styles.done}>{t('common.done')}</Text>
                </Pressable>
            </View>
            <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                {children}
            </BottomSheetScrollView>
        </BottomSheetModal>
    );
});

const styles = StyleSheet.create((theme) => ({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 4,
        paddingBottom: 16,
    },
    title: {
        ...Typography.default('semiBold'),
        flex: 1,
        fontSize: 18,
        color: theme.colors.text,
    },
    done: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.textLink,
    },
    content: {
        paddingHorizontal: KIT_PAGE_PADDING,
        gap: 12,
    },
}));

import React from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { retrieveTempText } from '@/sync/persistence';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { Ionicons } from '@expo/vector-icons';
import { SelectableTextView } from '@/components/SelectableTextView';
import { getNativeHeaderTitleWidth } from '@/utils/nativeHeaderTitleWidth';

export default function TextSelectionScreen() {
    const router = useRouter();
    const { textId } = useLocalSearchParams<{ textId: string }>();
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [fullText, setFullText] = React.useState<string>('');
    const [loading, setLoading] = React.useState(true);
    const { width: screenWidth } = useWindowDimensions();
    const bottomPadding = insets.bottom + 16;

    const headerTitleMaxWidth = getNativeHeaderTitleWidth({ screenWidth, rightActionCount: 1 });

    const handleCopyAll = React.useCallback(async () => {
        if (!fullText) {
            Modal.alert(t('common.error'), t('textSelection.noTextToCopy'));
            return;
        }

        try {
            await Clipboard.setStringAsync(fullText);
            hapticsLight(); showCopiedToast();
        } catch (error) {
            Modal.alert(t('common.error'), t('textSelection.failedToCopy'));
        }
    }, [fullText]);

    React.useEffect(() => {
        if (!textId) {
            Modal.alert(t('common.error'), t('textSelection.noTextProvided'), [
                { text: t('common.ok'), onPress: () => router.back() }
            ]);
            return;
        }

        const content = retrieveTempText(textId);
        if (content) {
            setFullText(content);
        } else {
            Modal.alert(t('common.error'), t('textSelection.textNotFound'), [
                { text: t('common.ok'), onPress: () => router.back() }
            ]);
        }
        setLoading(false);
    }, [textId, router]);

    if (loading) {
        return (
            <View style={styles.container}>
                <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    {t('common.loading')}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <Stack.Screen
                options={{
                    headerTitle: () => (
                        <View style={{ alignItems: 'center', justifyContent: 'center', maxWidth: headerTitleMaxWidth }}>
                            <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[Typography.default('semiBold'), { fontSize: 17, lineHeight: 24, color: theme.colors.header.tint }]}
                            >
                                {t('textSelection.title')}
                            </Text>
                        </View>
                    ),
                    headerRight: () => (
                        <Pressable
                            onPress={handleCopyAll}
                            style={({ pressed }) => [
                                {
                                    width: 38,
                                    height: 38,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: pressed ? 0.7 : 1,
                                }
                            ]}
                            disabled={loading || !fullText}
                        >
                            <Ionicons
                                name="copy-outline"
                                size={20}
                                color={loading || !fullText ? theme.colors.textSecondary : theme.colors.header.tint}
                            />
                        </Pressable>
                    ),
                }}
            />
            <SelectableTextView text={fullText} bottomPadding={bottomPadding} />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    loadingText: {
        ...Typography.default(),
        fontSize: 16,
        textAlign: 'center',
        marginTop: 50,
    },
}));

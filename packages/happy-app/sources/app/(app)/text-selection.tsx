import React from 'react';
import { View, Text, Pressable, useWindowDimensions, Platform } from 'react-native';
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
import { FileViewTabs, type FileViewTab } from '@/components/FilePreview/FileViewTabs';
import { SandboxDocument } from '@/components/FilePreview/SandboxDocument';
import { buildHtmlDocument, buildMarkdownDocument } from '@/components/FilePreview/staticDocument';
import { NativeMenu } from '@/components/NativeMenu';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import {
    resolveTextDocument,
    isTextDocumentCodeLanguage,
    TEXT_DOCUMENT_CODE_LANGUAGE_LABELS,
    type TextDocumentMode,
} from '@/utils/textDocument';
import { layout } from '@/components/layout';
import { messageDocumentView } from '@/components/messageDocument';
import { isRunningOnMac } from '@/utils/platform';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';

/**
 * A block of message text too large to sit in the chat list, opened as its own screen.
 *
 * Two tabs show the rendered document and the text as it was authored. Sources can provide a
 * format or code language; otherwise detection is conservative. A menu lets the user override
 * the format in both tabs. Which tab opens, and what the header calls the screen, depends
 * on what opened it — see `messageDocument.ts`, which reads the `from` param every collapsed row
 * sends. Long-press flows send nothing and get the screen this has always been.
 */
type DocumentTab = 'source' | 'preview';

export default function TextSelectionScreen() {
    const router = useRouter();
    const { textId, from, format, language } = useLocalSearchParams<{
        textId: string; from?: string; format?: string; language?: string;
    }>();
    const view = messageDocumentView(from);
    const { theme, rt } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [fullText, setFullText] = React.useState<string>('');
    const [loading, setLoading] = React.useState(true);
    const [mode, setMode] = React.useState<DocumentTab>(view.tab);
    const [renderError, setRenderError] = React.useState(false);
    const [attempt, setAttempt] = React.useState(0);
    const [documentMode, setDocumentMode] = React.useState<TextDocumentMode>('auto');
    const [formatMenuVisible, setFormatMenuVisible] = React.useState(false);
    const { width: screenWidth } = useWindowDimensions();
    const bottomPadding = insets.bottom + 16;
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();
    const softHeaderInset = useSoftHeaderInset();

    const headerTitleMaxWidth = getNativeHeaderTitleWidth({ screenWidth, rightActionCount: 1 });

    const automaticDocument = React.useMemo(
        () => resolveTextDocument({ text: fullText, sourceFormat: format, sourceLanguage: language }),
        [fullText, format, language]
    );
    const document = React.useMemo(
        () => documentMode === 'auto' ? automaticDocument : resolveTextDocument({ text: fullText, mode: documentMode }),
        [fullText, documentMode, automaticDocument]
    );
    const documentHtml = React.useMemo(
        () => document.format === 'html'
            ? buildHtmlDocument(fullText, rt.themeName === 'dark')
            : document.format === 'markdown'
                ? buildMarkdownDocument(fullText, rt.themeName === 'dark')
                : '',
        [fullText, document.format, rt.themeName]
    );

    React.useEffect(() => {
        setRenderError(false);
    }, [fullText, document.format, attempt]);

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

    // `retrieveTempText` consumes the entry it returns, so a second run of this effect for the same
    // id would find nothing and report the text as expired. Keep what we read instead.
    const retrieved = React.useRef<{ id: string; text: string } | null>(null);

    React.useEffect(() => {
        if (!textId) {
            Modal.alert(t('common.error'), t('textSelection.noTextProvided'), [
                { text: t('common.ok'), onPress: () => router.back() }
            ]);
            return;
        }

        if (retrieved.current?.id !== textId) {
            const content = retrieveTempText(textId);
            if (content !== null) {
                retrieved.current = { id: textId, text: content };
                setDocumentMode('auto');
            }
        }
        const content = retrieved.current?.id === textId ? retrieved.current.text : null;
        if (content !== null) {
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
            <View style={[styles.container, { paddingTop: softHeaderInset }]}>
                <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    {t('common.loading')}
                </Text>
            </View>
        );
    }

    const tabs: FileViewTab<DocumentTab>[] = [
        { value: 'preview', label: t('files.preview.title') },
        { value: 'source', label: t('files.preview.source') },
    ];
    const formatLabels = {
        markdown: 'Markdown',
        html: 'HTML',
        plain: t('textSelection.formatPlainText'),
        ...TEXT_DOCUMENT_CODE_LANGUAGE_LABELS,
    };
    const selectedFormat = document.format === 'plain' && isTextDocumentCodeLanguage(document.language)
        ? document.language
        : document.format;
    const formatLabel = formatLabels[selectedFormat];
    const availableFormats: Exclude<TextDocumentMode, 'auto'>[] = ['markdown', 'html', 'json'];
    // Keep a known source language available after an override so the user can return to it.
    if (automaticDocument.format === 'plain'
        && isTextDocumentCodeLanguage(automaticDocument.language)
        && automaticDocument.language !== 'json') {
        availableFormats.push(automaticDocument.language);
    }
    availableFormats.push('plain');
    const formatMenuItems = availableFormats.map((value) => ({
        label: formatLabels[value],
        selected: selectedFormat === value,
        onPress: () => setDocumentMode(value),
    }));

    const source = <SelectableTextView text={fullText} language={document.language} bottomPadding={bottomPadding} />;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <Stack.Screen
                options={{
                    headerTitle: useNativeSoftHeader ? t(view.titleKey) : () => (
                        <View style={{ alignItems: 'center', justifyContent: 'center', maxWidth: headerTitleMaxWidth }}>
                            <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[Typography.default('semiBold'), { fontSize: 17, lineHeight: 24, color: theme.colors.header.tint }]}
                            >
                                {t(view.titleKey)}
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
            <ActionMenuModal
                visible={formatMenuVisible}
                items={formatMenuItems}
                title={t('textSelection.formatTitle')}
                onClose={() => setFormatMenuVisible(false)}
            />
            {/* The tab bar is the screen's fixed top row, so it clears the soft header itself. */}
            <View style={{ paddingTop: softHeaderInset }}>
                <FileViewTabs
                    tabs={tabs}
                    value={mode}
                    onChange={setMode}
                    trailing={
                        <NativeMenu
                            items={formatMenuItems}
                            onFallbackOpen={() => setFormatMenuVisible(true)}
                            style={styles.formatSelector}
                        >
                            <Text
                                numberOfLines={1}
                                accessibilityLabel={`${t('textSelection.formatTitle')}: ${formatLabel}`}
                                style={styles.formatSelectorText}
                            >
                                {formatLabel}
                            </Text>
                            <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                        </NativeMenu>
                    }
                />
            </View>
            {mode === 'preview' ? (
                document.format === 'plain' ? source : renderError ? (
                    <View style={styles.previewError}>
                        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
                            {t('files.preview.renderError')}
                        </Text>
                        <Pressable onPress={() => setAttempt((value) => value + 1)} style={styles.previewRetry}>
                            <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
                            <Text style={{ color: theme.colors.text, fontSize: 14 }}>{t('files.preview.retry')}</Text>
                        </Pressable>
                    </View>
                ) : (
                    <SandboxDocument
                        key={`${document.format}-${attempt}`}
                        html={documentHtml}
                        scripts={document.format === 'html'}
                        dark={rt.themeName === 'dark'}
                        title={t('textSelection.title')}
                        onError={() => setRenderError(true)}
                    />
                )
            ) : (
                source
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        // Same content column every other screen uses, so a line of text does not run the width
        // of a desktop window.
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
    },
    loadingText: {
        ...Typography.default(),
        fontSize: 16,
        textAlign: 'center',
        marginTop: 50,
    },
    previewError: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    previewRetry: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    formatSelector: {
        marginLeft: 'auto',
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 4,
        paddingHorizontal: 8,
        flexShrink: 1,
    },
    formatSelectorText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
}));

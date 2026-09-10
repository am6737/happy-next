import * as React from 'react';
import {
    ActivityIndicator,
    Modal as NativeModal,
    Platform,
    Pressable,
    ScrollView,
    View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/StyledText';
import { CodeEditor } from '@/components/CodeEditor';
import { ImageViewer } from '@/components/ImageViewer';
import { FileIcon } from '@/components/FileIcon';
import { layout } from '@/components/layout';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Modal } from '@/modal';
import { t } from '@/text';
import { getSession } from '@/sync/storage';
import {
    sessionBash,
    sessionOpenFilePreview,
    sessionReadFilePreviewChunk,
    sessionCloseFilePreview,
} from '@/sync/ops';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { shellEscape } from '@/utils/shellEscape';
import { showCopiedToast } from '@/components/Toast';
import {
    loadFilePreview,
    FilePreviewLoadError,
    selectPreviewMode,
    type LoadedFilePreview,
} from './loadFilePreview';
import { buildStaticDocument, buildSvgDocument } from './staticDocument';
import { SandboxDocument } from './SandboxDocument';

export function FilePreviewScreen({ filePath }: { filePath: string }) {
    const params = useLocalSearchParams<{
        id: string;
        ref?: string;
        staged?: string;
        view?: string;
        line?: string;
        column?: string;
    }>();
    const { id: sessionId, ref, staged, view } = params;
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const session = getSession(sessionId);
    const sessionPath = session?.metadata?.path || '';
    const repoPath =
        getWorkspaceRepos(session?.metadata)
            .filter((repo) => filePath.startsWith(`${repo.path}/`))
            .sort((a, b) => b.path.length - a.path.length)[0]?.path ||
        sessionPath;
    const fileName = filePath.split('/').pop() || filePath;
    const relativePath = filePath.startsWith(`${repoPath}/`)
        ? filePath.slice(repoPath.length + 1)
        : filePath;
    const compare = view === 'diff' || !!ref || staged === '1';
    const [loaded, setLoaded] = React.useState<LoadedFilePreview | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    const [mode, setMode] = React.useState<'preview' | 'file' | 'diff'>(
        'preview'
    );
    const [renderError, setRenderError] = React.useState(false);
    const [fullscreen, setFullscreen] = React.useState(false);
    const [imageVisible, setImageVisible] = React.useState(false);
    const [darkBackground, setDarkBackground] = React.useState(false);
    const [svgZoom, setSvgZoom] = React.useState(1);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [exporting, setExporting] = React.useState(false);
    const [pdfTemplate, setPdfTemplate] = React.useState<string | null>(null);

    React.useEffect(() => {
        const controller = new AbortController();
        setLoaded(null);
        setError(null);
        setRenderError(false);
        setFullscreen(false);
        setImageVisible(false);
        void loadFilePreview(
            {
                path: filePath,
                repoPath,
                version: ref ? 'commit' : staged === '1' ? 'index' : 'worktree',
                revision: ref,
                compare,
            },
            {
                open: (request) => sessionOpenFilePreview(sessionId, request),
                chunk: (token, offset) =>
                    sessionReadFilePreviewChunk(sessionId, token, offset),
                close: (token) => sessionCloseFilePreview(sessionId, token),
            },
            controller.signal
        )
            .then((result) => {
                if (controller.signal.aborted) return;
                setLoaded(result);
                setMode(
                    selectPreviewMode(
                        params.line ? 'file' : view,
                        !!result.metadata.diff,
                        result.text !== null,
                        compare
                    )
                );
            })
            .catch((cause) => {
                if (controller.signal.aborted) return;
                const code =
                    cause instanceof FilePreviewLoadError
                        ? cause.code
                        : 'unavailable';
                setError(
                    code === 'too_large'
                        ? t('files.preview.tooLarge')
                        : code === 'denied'
                          ? t('files.preview.denied')
                          : code === 'expired'
                            ? t('files.preview.expired')
                            : t('files.preview.unavailable')
                );
            });
        return () => controller.abort();
    }, [
        sessionId,
        filePath,
        repoPath,
        ref,
        staged,
        compare,
        view,
        params.line,
        attempt,
    ]);

    const handleExport = React.useCallback(async () => {
        if (!loaded || exporting) return;
        setExporting(true);
        const outputFileName =
            loaded.metadata.path.split('/').pop() || fileName;
        try {
            if (Platform.OS === 'web') {
                const url = URL.createObjectURL(
                    new Blob([new Uint8Array(loaded.data)], {
                        type: loaded.metadata.mimeType,
                    })
                );
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = outputFileName;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } else {
                if (!(await Sharing.isAvailableAsync()))
                    throw new Error('Sharing unavailable');
                const file = new File(
                    Paths.cache,
                    `preview-${Date.now()}-${outputFileName}`
                );
                try {
                    file.create({ overwrite: true });
                    file.write(loaded.data);
                    await Sharing.shareAsync(file.uri, {
                        mimeType: loaded.metadata.mimeType,
                        dialogTitle: fileName,
                    });
                } finally {
                    if (file.exists) file.delete();
                }
            }
        } catch {
            Modal.alert(t('common.error'), t('files.preview.unavailable'));
        } finally {
            setExporting(false);
        }
    }, [loaded, fileName, exporting]);

    const menuItems: ActionMenuItem[] = [
        {
            label: t('files.preview.retry'),
            onPress: () => setAttempt((value) => value + 1),
        },
        {
            label: t('files.copyRelativePath'),
            onPress: async () => {
                await Clipboard.setStringAsync(relativePath);
                showCopiedToast();
            },
        },
        {
            label: t('files.copyFileName'),
            onPress: async () => {
                await Clipboard.setStringAsync(fileName);
                showCopiedToast();
            },
        },
    ];
    if (loaded)
        menuItems.push({
            label:
                Platform.OS === 'web'
                    ? t('files.preview.download')
                    : t('files.share'),
            onPress: handleExport,
        });
    if (!ref)
        menuItems.push({
            label: t('files.fileHistory'),
            onPress: () =>
                router.push(
                    `/session/${sessionId}/commits?file=${encodeURIComponent(relativePath)}`
                ),
        });
    if (
        loaded?.text !== null &&
        loaded &&
        !ref &&
        staged !== '1' &&
        !loaded.metadata.deleted
    ) {
        menuItems.push({
            label: t('files.editFile'),
            onPress: () =>
                router.push(
                    `/session/${sessionId}/edit?path=${encodeURIComponent(btoa(new TextEncoder().encode(filePath).reduce((s, b) => s + String.fromCharCode(b), '')))}`
                ),
        });
    }
    if (!ref && loaded && !loaded.metadata.deleted)
        menuItems.push({
            label: t('files.deleteFile'),
            destructive: true,
            onPress: async () => {
                if (
                    !(await Modal.confirm(
                        t('files.deleteFile'),
                        t('files.deleteFileConfirm', { fileName }),
                        { destructive: true }
                    ))
                )
                    return;
                const response = await sessionBash(sessionId, {
                    command: `rm -- ${shellEscape(filePath)}`,
                    cwd: repoPath,
                    timeout: 5000,
                });
                if (response.success) router.back();
                else
                    Modal.alert(t('common.error'), t('files.deleteFileFailed'));
            },
        });

    const kind = loaded?.metadata.kind;
    React.useEffect(() => {
        if (kind !== 'pdf' || pdfTemplate) return;
        let cancelled = false;
        void (async () => {
            const asset = await Asset.fromModule(
                require('./generated/pdfReader.html')
            ).downloadAsync();
            const uri = asset.localUri || asset.uri;
            let html: string;
            if (Platform.OS === 'web') {
                const response = await fetch(uri);
                if (!response.ok) throw new Error('Reader asset unavailable');
                html = await response.text();
            } else {
                html = await new File(uri).text();
            }
            if (!cancelled) setPdfTemplate(html);
        })().catch(() => {
            if (!cancelled) setRenderError(true);
        });
        return () => {
            cancelled = true;
        };
    }, [kind, pdfTemplate, attempt]);
    const imageUri =
        loaded && (kind === 'svg' || kind === 'image')
            ? `data:${loaded.metadata.mimeType};base64,${loaded.base64}`
            : null;
    const documentHtml = React.useMemo(() => {
        if (!loaded) return null;
        try {
            if (
                loaded.metadata.kind === 'html' ||
                loaded.metadata.kind === 'markdown'
            )
                return buildStaticDocument(
                    loaded.text || '',
                    loaded.metadata.kind,
                    darkBackground
                );
            if (loaded.metadata.kind === 'pdf') {
                if (!pdfTemplate) return null;
                const labels = {
                    previous: t('files.preview.previous'),
                    next: t('files.preview.next'),
                    page: t('files.preview.page'),
                    zoomIn: t('files.preview.zoomIn'),
                    zoomOut: t('files.preview.zoomOut'),
                    fit: t('files.preview.fit'),
                    search: t('files.preview.search'),
                    loading: t('files.preview.loading'),
                    encrypted: t('files.preview.encrypted'),
                    renderError: t('files.preview.renderError'),
                    notFound: t('files.preview.notFound'),
                    unsupported: t('files.preview.unsupported'),
                };
                return pdfTemplate.replace(
                    '__HAPPY_DOCUMENT__',
                    JSON.stringify({ base64: loaded.base64, labels }).replace(
                        /</g,
                        '\\u003c'
                    )
                );
            }
        } catch {
            return null;
        }
        return null;
    }, [loaded, pdfTemplate, darkBackground]);

    function icon(
        name: React.ComponentProps<typeof Ionicons>['name'],
        label: string,
        onPress: () => void,
        disabled = false
    ) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={disabled}
                onPress={onPress}
                {...(Platform.OS === 'web' ? { title: label } : {})}
                style={{
                    width: 38,
                    height: 38,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: disabled ? 0.4 : 1,
                }}
            >
                <Ionicons name={name} size={20} color={theme.colors.text} />
            </Pressable>
        );
    }

    const imageTools = (
        <>
            {kind === 'svg' && (
                <>
                    {icon(
                        'remove-outline',
                        t('files.preview.zoomOut'),
                        () =>
                            setSvgZoom((value) => Math.max(0.5, value - 0.25)),
                        svgZoom <= 0.5
                    )}
                    {icon(
                        'add-outline',
                        t('files.preview.zoomIn'),
                        () => setSvgZoom((value) => Math.min(4, value + 0.25)),
                        svgZoom >= 4
                    )}
                    {icon('scan-outline', t('files.preview.fit'), () =>
                        setSvgZoom(1)
                    )}
                </>
            )}
            {kind &&
                icon('contrast-outline', t('files.preview.background'), () =>
                    setDarkBackground((value) => !value)
                )}
            {icon('download-outline', t('files.preview.download'), handleExport, exporting || !loaded)}
        </>
    );

    const preview = renderError ? (
        <View
            style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
            }}
        >
            <Text style={{ color: theme.colors.textSecondary }}>
                {t('files.preview.renderError')}
            </Text>
            {icon('refresh-outline', t('files.preview.retry'), () =>
                setAttempt((value) => value + 1)
            )}
        </View>
    ) : kind === 'svg' && loaded ? (
        <View style={{ flex: 1 }}>
            <SandboxDocument
                html={buildSvgDocument(loaded.base64, darkBackground, svgZoom)}
                title={fileName}
                onError={() => setRenderError(true)}
            />
        </View>
    ) : imageUri ? (
        <View
            style={{
                flex: 1,
                backgroundColor: darkBackground ? '#202124' : '#ffffff',
            }}
        >
            <Pressable
                accessibilityLabel={t('files.preview.fullscreen')}
                onPress={() => setImageVisible(true)}
                style={{ flex: 1, padding: 12 }}
            >
                <Image
                    source={{ uri: imageUri }}
                    contentFit="contain"
                    onError={() => setRenderError(true)}
                    style={{ width: '100%', height: '100%' }}
                />
            </Pressable>
        </View>
    ) : kind === 'pdf' && !pdfTemplate ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
            <ActivityIndicator />
        </View>
    ) : documentHtml ? (
        <SandboxDocument
            html={documentHtml}
            scripts={kind === 'pdf'}
            dark={darkBackground}
            title={fileName}
            onError={() => setRenderError(true)}
        />
    ) : loaded ? (
        <View style={{ padding: 24 }}>
            <Text style={{ color: theme.colors.textSecondary }}>
                {t('files.preview.renderError')}
            </Text>
        </View>
    ) : null;

    const version = loaded?.metadata.version;
    const versionLabel =
        version === 'commit'
            ? `${t('files.preview.commit')} ${loaded?.metadata.revision?.slice(0, 8) || ''}`
            : version === 'index'
              ? t('files.preview.index')
              : null;
    const versionNotice = loaded?.metadata.deleted
        ? [t('files.preview.deleted'), versionLabel].filter(Boolean).join(' · ')
        : versionLabel;
    const hasMetadataNotice =
        !!versionNotice ||
        loaded?.metadata.diffUnavailable ||
        (loaded?.metadata.changed && loaded.text === null);
    const tabs: { value: 'preview' | 'file' | 'diff'; label: string }[] = [
        { value: 'preview', label: t('files.preview.title') },
    ];
    if (loaded?.text !== null && loaded)
        tabs.push({ value: 'file', label: t('files.preview.source') });
    if (loaded?.metadata.diff)
        tabs.push({ value: 'diff', label: t('files.diff') });

    return (
        <View
            style={{
                flex: 1,
                maxWidth: layout.maxWidth,
                alignSelf: 'center',
                width: '100%',
                backgroundColor: theme.colors.surface,
            }}
        >
            <Stack.Screen
                options={{
                    headerRight: () =>
                        icon('ellipsis-horizontal', t('files.file'), () =>
                            setMenuVisible(true)
                        ),
                }}
            />
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
            />
            <View
                style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                }}
            >
                <FileIcon
                    fileName={loaded?.metadata.path || fileName}
                    size={20}
                />
                <Text
                    selectable
                    style={{
                        flex: 1,
                        color: theme.colors.textSecondary,
                        fontSize: 13,
                    }}
                    numberOfLines={2}
                >
                    {loaded?.metadata.path || relativePath}
                </Text>
            </View>
            {error ? (
                <View
                    style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 24,
                        gap: 12,
                    }}
                >
                    <Text
                        style={{
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                        }}
                    >
                        {error}
                    </Text>
                    {icon('refresh-outline', t('files.preview.retry'), () =>
                        setAttempt((value) => value + 1)
                    )}
                </View>
            ) : !loaded ? (
                <View style={{ flex: 1, justifyContent: 'center' }}>
                    <ActivityIndicator />
                </View>
            ) : (
                <>
                    {hasMetadataNotice && (
                        <View
                            style={{
                                paddingHorizontal: 16,
                                paddingVertical: 6,
                                gap: 4,
                            }}
                        >
                            {versionNotice && (
                                <Text
                                    style={{
                                        color: theme.colors.textSecondary,
                                        fontSize: 12,
                                    }}
                                >
                                    {versionNotice}
                                </Text>
                            )}
                            {loaded.metadata.diffUnavailable && (
                                <Text
                                    style={{
                                        color: theme.colors.textSecondary,
                                        fontSize: 12,
                                    }}
                                >
                                    {t('files.preview.diffUnavailable')}
                                </Text>
                            )}
                            {loaded.metadata.changed &&
                                loaded.text === null && (
                                    <Text
                                        style={{
                                            color: theme.colors.textSecondary,
                                            fontSize: 12,
                                        }}
                                    >
                                        {t('files.preview.changed')}
                                    </Text>
                                )}
                        </View>
                    )}
                    <View
                        style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            paddingHorizontal: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                        }}
                    >
                        <View style={{ flexDirection: 'row', flexShrink: 0 }}>
                            {tabs.map((tab) => (
                                <Pressable
                                    key={tab.value}
                                    accessibilityRole="tab"
                                    accessibilityState={{
                                        selected: mode === tab.value,
                                    }}
                                    onPress={() => setMode(tab.value)}
                                    style={{
                                        paddingHorizontal: 12,
                                        minHeight: 40,
                                        justifyContent: 'center',
                                        borderBottomWidth: 2,
                                        borderBottomColor:
                                            mode === tab.value
                                                ? theme.colors.textLink
                                                : 'transparent',
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 14,
                                            color:
                                                mode === tab.value
                                                    ? theme.colors.textLink
                                                    : theme.colors
                                                          .textSecondary,
                                        }}
                                    >
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                        {mode === 'preview' && (
                            <View
                                style={{
                                    flexDirection: 'row',
                                    marginLeft: 'auto',
                                    flexShrink: 0,
                                    minHeight: 40,
                                    alignItems: 'center',
                                }}
                            >
                                {imageTools}
                                {icon(
                                    'expand-outline',
                                    t('files.preview.fullscreen'),
                                    () =>
                                        kind === 'image'
                                            ? setImageVisible(true)
                                            : setFullscreen(true)
                                )}
                            </View>
                        )}
                    </View>
                    {mode === 'preview' ? (
                        !fullscreen && preview
                    ) : mode === 'file' ? (
                        <CodeEditor
                            value={loaded.text || ''}
                            onChangeText={() => {}}
                            readOnly
                            language={
                                kind === 'markdown'
                                    ? 'markdown'
                                    : kind === 'svg'
                                      ? 'xml'
                                      : 'html'
                            }
                            revealLine={Number(params.line) || undefined}
                            revealColumn={Number(params.column) || undefined}
                            bottomPadding={12}
                        />
                    ) : (
                        <ScrollView contentContainerStyle={{ padding: 12 }}>
                            <ScrollView horizontal>
                                <View>
                                    {loaded.metadata.diff
                                        .split('\n')
                                        .map((line, index) => (
                                            <Text
                                                key={index}
                                                selectable
                                                style={{
                                                    fontFamily:
                                                        Platform.OS === 'ios'
                                                            ? 'Menlo'
                                                            : 'monospace',
                                                    fontSize: 13,
                                                    lineHeight: 20,
                                                    color: line.startsWith('+')
                                                        ? theme.colors.diff
                                                              .addedText
                                                        : line.startsWith('-')
                                                          ? theme.colors.diff
                                                                .removedText
                                                          : theme.colors.text,
                                                    backgroundColor:
                                                        line.startsWith('+')
                                                            ? theme.colors.diff
                                                                  .addedBg
                                                            : line.startsWith(
                                                                    '-'
                                                                )
                                                              ? theme.colors
                                                                    .diff
                                                                    .removedBg
                                                              : 'transparent',
                                                }}
                                            >
                                                {line || ' '}
                                            </Text>
                                        ))}
                                </View>
                            </ScrollView>
                        </ScrollView>
                    )}
                </>
            )}
            <NativeModal
                visible={fullscreen}
                onRequestClose={() => setFullscreen(false)}
                presentationStyle="fullScreen"
            >
                <View
                    style={{
                        flex: 1,
                        paddingTop: insets.top,
                        paddingBottom: insets.bottom,
                        backgroundColor: theme.colors.surface,
                    }}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            justifyContent: 'flex-end',
                            alignItems: 'center',
                        }}
                    >
                        {imageTools}
                        {icon('close-outline', t('common.cancel'), () =>
                            setFullscreen(false)
                        )}
                    </View>
                    {fullscreen && preview}
                </View>
            </NativeModal>
            {imageUri && kind === 'image' && (
                <ImageViewer
                    images={[{ uri: imageUri }]}
                    initialIndex={0}
                    visible={imageVisible}
                    onClose={() => setImageVisible(false)}
                />
            )}
        </View>
    );
}

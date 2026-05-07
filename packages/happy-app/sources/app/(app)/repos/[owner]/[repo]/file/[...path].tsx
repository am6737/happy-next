import * as React from 'react';
import { View, ScrollView, Pressable, Platform, Share, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import { sessionReadFile, machineListClaudeSessions } from '@/sync/ops';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';

function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop() ?? '';
    const map: Record<string, string> = {
        ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
        json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML',
        py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
        sh: 'Shell', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    };
    return map[ext] ?? 'Plain Text';
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
        gap: 10,
    },
    fileName: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    langBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    langText: {
        fontSize: 11,
        fontWeight: '500',
        color: theme.colors.textSecondary,
    },
    binaryContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    binaryIcon: {
        width: 64,
        height: 64,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    binaryText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 12,
    },
    notFoundContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    notFoundText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 12,
    },
    content: {
        padding: 16,
        paddingBottom: 40,
    },
    codeContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    codeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: theme.colors.surfaceHighest,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
    },
    codeHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    codeHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    actionBtnText: {
        fontSize: 12,
        color: theme.colors.textLink,
    },
    lineCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    codeScroll: {
        maxHeight: 500,
    },
    codeText: {
        fontSize: 13,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        color: theme.colors.text,
        lineHeight: 20,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 12,
    },
}));

export default function FileViewerScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    // path is a catch-all array from [...path].tsx
    const { path } = useLocalSearchParams<{ path: string | string[] }>();

    // Normalize path: it comes as array from catch-all route
    const pathString = Array.isArray(path) ? path.join('/') : (path ?? '');
    const fileName = pathString.split('/').pop() ?? pathString;

    const [content, setContent] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    // Get machines and registered repos from storage
    const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;
    const allRegisteredRepos = storage(useShallow((state) => state.registeredRepos)) as Record<string, RegisteredRepo[]>;

    // Find registered repos for this owner/repo
    const registeredRepos = React.useMemo(() => {
        return Object.entries(allRegisteredRepos)
            .flatMap(([machineId, repos]: [string, RegisteredRepo[]]) =>
                repos
                    .filter((r) => r.path?.includes(`${owner}/${repoName}`))
                    .map((r) => ({ ...r, machineId }))
            );
    }, [allRegisteredRepos, owner, repoName]);

    // Load file content
    React.useEffect(() => {
        if (!pathString) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        async function loadContent() {
            // Find a session on a machine with this repo
            for (const regRepo of registeredRepos) {
                const machine = machines[regRepo.machineId];
                if (!machine || !isMachineOnline(machine)) continue;

                try {
                    const result = await machineListClaudeSessions(regRepo.machineId, { timeoutMs: 5000 });

                    // Find a session that was started in this repo's directory
                    for (const session of result.sessions) {
                        if (session.originalPath && regRepo.path &&
                            session.originalPath.includes(regRepo.path.split('/').pop() || '')) {

                            const fileResult = await sessionReadFile(session.sessionId, pathString);
                            if (fileResult.success && fileResult.content) {
                                // Content is base64 encoded
                                const decoded = atob(fileResult.content);
                                if (!cancelled) {
                                    setContent(decoded);
                                    setLoading(false);
                                    return;
                                }
                            }
                        }
                    }
                } catch {
                    // Continue to next machine
                }
            }

            if (!cancelled) {
                setError('File not found or no session available');
                setLoading(false);
            }
        }

        loadContent();
        return () => { cancelled = true; };
    }, [pathString, registeredRepos, machines, owner, repoName]);

    const lineCount = content ? content.split('\n').length : 0;

    const handleCopyPath = React.useCallback(() => {
        Modal.alert(
            t('browser.pathCopied') ?? 'Path copied',
            pathString
        );
    }, [pathString]);

    const handleShare = React.useCallback(async () => {
        try {
            await Share.share({
                message: `https://github.com/${owner}/${repoName}/blob/main/${pathString}`,
                title: fileName,
            });
        } catch {
            // User cancelled or error
        }
    }, [owner, repoName, pathString, fileName]);

    const isBinary = false;

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: fileName || t('browser.title') }} />

            {/* File header */}
            <View style={styles.header}>
                <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
                <View style={styles.langBadge}>
                    <Text style={styles.langText}>{detectLanguage(fileName)}</Text>
                </View>
            </View>

            {loading ? (
                <View style={styles.emptyContainer}>
                    <ActivityIndicator size="large" color={theme.colors.textSecondary} />
                </View>
            ) : error ? (
                <View style={styles.notFoundContainer}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.notFoundText}>{error}</Text>
                </View>
            ) : content === null ? (
                <View style={styles.notFoundContainer}>
                    <Ionicons name="document-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.notFoundText}>
                        {t('browser.failedToLoad')}
                    </Text>
                </View>
            ) : content.trim() === '' ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="document-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('browser.fileEmpty') ?? 'File is empty'}</Text>
                </View>
            ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                    <View style={styles.codeContainer}>
                        {/* Code header bar */}
                        <View style={styles.codeHeader}>
                            <View style={styles.codeHeaderLeft}>
                                <Ionicons name="code-slash" size={14} color={theme.colors.textSecondary} />
                                <Text style={styles.lineCount}>
                                    {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                                </Text>
                            </View>
                            <View style={styles.codeHeaderRight}>
                                <Pressable style={styles.actionBtn} onPress={handleCopyPath}>
                                    <Ionicons name="link-outline" size={13} color={theme.colors.textLink} />
                                    <Text style={styles.actionBtnText}>{t('browser.copyPath')}</Text>
                                </Pressable>
                                <Pressable style={styles.actionBtn} onPress={handleShare}>
                                    <Ionicons name="share-outline" size={13} color={theme.colors.textLink} />
                                    <Text style={styles.actionBtnText}>{t('files.share')}</Text>
                                </Pressable>
                            </View>
                        </View>

                        {/* Code content */}
                        <ScrollView style={styles.codeScroll} horizontal={false}>
                            <Text style={styles.codeText} selectable>{content}</Text>
                        </ScrollView>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

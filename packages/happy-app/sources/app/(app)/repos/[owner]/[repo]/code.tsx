import * as React from 'react';
import { View, FlatList, Platform, Pressable, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import { sessionListDirectory } from '@/sync/ops';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';
import type { DirectoryEntry } from '@/sync/ops';

interface RepoFile {
    name: string;
    type: 'file' | 'dir';
    path: string;
}

const FILE_ICONS: Record<string, string> = {
    ts: 'document-text',
    tsx: 'document-text',
    js: 'document-text',
    jsx: 'document-text',
    json: 'code-slash',
    md: 'document-outline',
    css: 'color-palette-outline',
    png: 'image-outline',
    jpg: 'image-outline',
    svg: 'image-outline',
    gitignore: 'git-branch-outline',
    '': 'document-outline',
};

function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop() ?? '';
    return FILE_ICONS[ext] ?? 'document-outline';
}


const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    breadcrumb: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
        gap: 4,
    },
    breadcrumbText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    breadcrumbActive: {
        fontSize: 13,
        color: theme.colors.text,
        fontWeight: '500',
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
        gap: 12,
    },
    fileName: {
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    dirChevron: {
        color: theme.colors.textSecondary,
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

export default function RepoCodeScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName, branch } = useLocalSearchParams<{ owner: string; repo: string; branch?: string }>();

    const [currentPath, setCurrentPath] = React.useState('');
    const [files, setFiles] = React.useState<RepoFile[]>([]);
    const [loading, setLoading] = React.useState(false);
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

    // Find a session to use for file listing
    const findSessionForRepo = React.useCallback(async (): Promise<{ machineId: string; sessionId: string } | null> => {
        // For now, try to find any online machine with this repo
        for (const regRepo of registeredRepos) {
            const machine = machines[regRepo.machineId];
            if (!machine || !isMachineOnline(machine)) continue;

            // Get sessions from this machine
            try {
                const { machineListClaudeSessions } = await import('@/sync/ops');
                const result = await machineListClaudeSessions(regRepo.machineId, { timeoutMs: 5000 });

                // Find a session that was started in this repo's directory
                for (const session of result.sessions) {
                    if (session.originalPath && regRepo.path && session.originalPath.includes(regRepo.path.split('/').pop() || '')) {
                        return { machineId: regRepo.machineId, sessionId: session.sessionId };
                    }
                }
            } catch {
                // Continue to next machine
            }
        }
        return null;
    }, [registeredRepos, machines]);

    // Load files for current path
    const loadFiles = React.useCallback(async (path: string) => {
        setLoading(true);
        setError(null);

        try {
            const sessionInfo = await findSessionForRepo();
            if (!sessionInfo) {
                setError('No active session available. Please start a session first.');
                setFiles([]);
                setLoading(false);
                return;
            }

            const result = await sessionListDirectory(sessionInfo.sessionId, path);
            if (result.success && result.entries) {
                const repoFiles: RepoFile[] = result.entries.map((entry: DirectoryEntry) => ({
                    name: entry.name,
                    type: entry.type === 'directory' ? 'dir' : 'file',
                    path: path ? `${path}/${entry.name}` : entry.name,
                }));
                setFiles(repoFiles);
            } else {
                setError(result.error || 'Failed to load files');
                setFiles([]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, [findSessionForRepo]);

    // Load files when path changes
    React.useEffect(() => {
        if (registeredRepos.length > 0) {
            loadFiles(currentPath);
        }
    }, [currentPath, registeredRepos, loadFiles]);

    const navigateToDir = (path: string) => {
        setCurrentPath(path);
    };

    const navigateToParent = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        setCurrentPath(parts.join('/'));
    };

    const pathParts = currentPath.split('/').filter(Boolean);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: t('browser.title') }} />

            {/* Breadcrumb */}
            <View style={styles.breadcrumb}>
                <Pressable onPress={navigateToParent} hitSlop={8} style={{ marginRight: 4 }}>
                    <Ionicons name="chevron-back" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable onPress={() => setCurrentPath('')}>
                    <Text style={styles.breadcrumbText}>{owner}/</Text>
                </Pressable>
                <Text style={styles.breadcrumbText}>{repoName}/</Text>
                {pathParts.length > 0 && pathParts.map((part, i) => (
                    <React.Fragment key={part}>
                        <Pressable onPress={() => {
                            // Navigate to this part's directory
                            const targetParts = pathParts.slice(0, i + 1);
                            setCurrentPath(targetParts.join('/'));
                        }}>
                            <Text style={i === pathParts.length - 1 ? styles.breadcrumbActive : styles.breadcrumbText}>
                                {part}
                            </Text>
                        </Pressable>
                        {i < pathParts.length - 1 && <Text style={styles.breadcrumbText}>/</Text>}
                    </React.Fragment>
                ))}
                {branch && (
                    <Text style={{ marginLeft: 8, fontSize: 11, color: theme.colors.textSecondary }}>
                        @ {branch}
                    </Text>
                )}
            </View>

            {loading ? (
                <View style={styles.emptyContainer}>
                    <ActivityIndicator size="large" color={theme.colors.textSecondary} />
                </View>
            ) : error ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{error}</Text>
                </View>
            ) : files.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="folder-open-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('browser.emptyDirectory')}</Text>
                </View>
            ) : (
                <FlatList
                    data={files}
                    keyExtractor={(item) => item.path}
                    renderItem={({ item }) => (
                        <Pressable
                            style={styles.fileItem}
                            onPress={() => {
                                if (item.type === 'dir') {
                                    navigateToDir(item.path);
                                } else {
                                    router.push(`/repos/${owner}/${repoName}/file/${encodeURIComponent(item.path)}`);
                                }
                            }}
                        >
                            <Ionicons
                                name={item.type === 'dir' ? 'folder' : 'document-outline'}
                                size={20}
                                color={item.type === 'dir' ? '#F5A623' : theme.colors.textSecondary}
                            />
                            <Text style={styles.fileName}>{item.name}</Text>
                            {item.type === 'dir' && (
                                <Ionicons name="chevron-forward" size={16} style={styles.dirChevron} />
                            )}
                        </Pressable>
                    )}
                    contentContainerStyle={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                />
            )}
        </View>
    );
}

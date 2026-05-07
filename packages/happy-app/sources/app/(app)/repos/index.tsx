import * as React from 'react';
import { View, FlatList, Pressable, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { subscribeCreatingRepo, subscribeCreatingBatch, getCreatingStepLabel, getPendingCreatingRepo, type RepoInfo } from '@/data/mockRepos';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';

const LANGUAGE_COLORS: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Shell: '#89e051',
    MDX: '#fcb32c',
};

function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    searchContainer: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    searchInput: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('regular'),
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
        marginBottom: 10,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    repoName: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    privateBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHighest,
    },
    privateBadgeText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    description: {
        marginTop: 6,
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    statsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        gap: 16,
    },
    stat: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 52,
    },
    statText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        minWidth: 32,
    },
    issueBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.button.primary.background,
    },
    issueBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.colors.button.primary.tint,
    },
    updatedText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 6,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
    },
    emptySubtitle: {
        marginTop: 8,
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    languageDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    // Creating card
    creatingCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
        marginBottom: 10,
    },
    creatingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    creatingTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    creatingBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: '#FF950020',
        borderWidth: 1,
        borderColor: '#FF950040',
    },
    creatingBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#FF9500',
    },
    creatingDesc: {
        marginTop: 6,
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    creatingProgressBar: {
        height: 4,
        backgroundColor: theme.colors.divider,
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 10,
    },
    creatingProgressFill: {
        height: '100%',
        backgroundColor: '#007AFF',
    },
    creatingStepText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 6,
    },
}));

export default function ReposListScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const [search, setSearch] = React.useState('');
    const [refreshing, setRefreshing] = React.useState(false);

    // Multiple creating repos support
    const [creatingRepos, setCreatingRepos] = React.useState<RepoInfo[]>([]);
    const [creatingProgressMap, setCreatingProgressMap] = React.useState<Map<string, number>>(new Map());
    const [isCreatingDoneMap, setIsCreatingDoneMap] = React.useState<Map<string, boolean>>(new Map());
    const [syncingRepos, setSyncingRepos] = React.useState<Set<string>>(new Set());

    // Get machines and registered repos from storage
    const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;
    const allRegisteredRepos = storage(useShallow((state) => state.registeredRepos)) as Record<string, RegisteredRepo[]>;

    // Transform registered repos to RepoInfo format for display
    const registeredRepos: RepoInfo[] = React.useMemo(() => {
        return Object.entries(allRegisteredRepos).flatMap(([machineId, repos]) =>
            repos.map((r): RepoInfo => {
                // Extract owner/repo from path like /home/user/repos/owner/repo
                const pathParts = r.path.split('/');
                const owner = pathParts[pathParts.length - 2] || machineId;
                const repoName = pathParts[pathParts.length - 1] || r.displayName || 'unknown';
                const fullName = `${owner}/${repoName}`;
                const machine = machines[machineId];
                const isOnline = machine && isMachineOnline(machine);

                return {
                    fullName,
                    name: repoName,
                    owner,
                    description: `Registered on ${machine?.metadata?.host || machineId}`,
                    language: '',
                    stars: 0,
                    forks: 0,
                    watchers: 0,
                    openIssuesCount: 0,
                    openPRsCount: 0,
                    repoSizeKb: 0,
                    createdAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : new Date().toISOString(),
                    pushedAt: new Date().toISOString(),
                    defaultBranch: r.defaultTargetBranch || 'main',
                    branches: [r.defaultTargetBranch || 'main'],
                    updatedAt: new Date().toISOString(),
                    isPrivate: false,
                    readme: '',
                    lastSyncedAt: undefined,
                    machineId,
                };
            })
        );
    }, [allRegisteredRepos, machines]);

    // Subscribe to pending creating repo from add.tsx (single or batch)
    React.useEffect(() => {
        const unsubBatch = subscribeCreatingBatch((repos) => {
            setCreatingRepos((prev) => {
                const existing = new Set(prev.map((r) => r.fullName));
                return [...prev, ...repos.filter((r) => !existing.has(r.fullName))];
            });
            setCreatingProgressMap((prev) => {
                const next = new Map(prev);
                repos.forEach((r) => next.set(r.fullName, 0));
                return next;
            });
            setIsCreatingDoneMap((prev) => {
                const next = new Map(prev);
                repos.forEach((r) => next.set(r.fullName, false));
                return next;
            });
        });

        const unsubSingle = subscribeCreatingRepo((repo) => {
            if (repo) {
                setCreatingRepos((prev) => {
                    if (prev.some((r) => r.fullName === repo.fullName)) return prev;
                    return [...prev, repo];
                });
                setCreatingProgressMap((prev) => {
                    const next = new Map(prev);
                    next.set(repo.fullName, 0);
                    return next;
                });
                setIsCreatingDoneMap((prev) => {
                    const next = new Map(prev);
                    next.set(repo.fullName, false);
                    return next;
                });
            }
        });
        return () => {
            unsubBatch();
            unsubSingle();
        };
    }, []);

    // Animate creating progress for all repos simultaneously (100ms interval, 0 → 100 in ~10s)
    React.useEffect(() => {
        if (creatingRepos.length === 0) return;
        const interval = setInterval(() => {
            setCreatingProgressMap((prevMap) => {
                const nextMap = new Map(prevMap);
                nextMap.forEach((progress, fullName) => {
                    const done = isCreatingDoneMap.get(fullName);
                    if (done) return;
                    if (progress >= 100) {
                        setIsCreatingDoneMap((prev) => {
                            const next = new Map(prev);
                            next.set(fullName, true);
                            return next;
                        });
                    } else {
                        nextMap.set(fullName, progress + 1);
                    }
                });
                return nextMap;
            });
        }, 100);
        return () => clearInterval(interval);
    }, [creatingRepos, isCreatingDoneMap]);

    React.useEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16 }}>
                    <Pressable onPress={() => router.push('/repos/add')}>
                        <Ionicons name="add" size={22} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, router, theme]);

    const displayList = React.useMemo(() => {
        // creatingRepos may overlap with registeredRepos — deduplicate by fullName
        const seen = new Set(creatingRepos.map((r) => r.fullName));
        const base = [...creatingRepos, ...registeredRepos.filter((r) => !seen.has(r.fullName))];
        if (!search.trim()) return base;
        const q = search.toLowerCase();
        return base.filter(
            (r) => r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
        );
    }, [search, creatingRepos, registeredRepos]);

    const isCreatingItem = (item: RepoInfo) =>
        !isCreatingDoneMap.get(item.fullName) && creatingRepos.some((r) => r.fullName === item.fullName);

    const getCreatingProgress = (fullName: string) =>
        creatingProgressMap.get(fullName) ?? 0;

    const handleRefresh = React.useCallback(() => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 800);
    }, []);

    const handleSyncRepo = React.useCallback((fullName: string) => {
        setSyncingRepos((prev) => new Set(prev).add(fullName));
        setTimeout(() => {
            setSyncingRepos((prev) => {
                const next = new Set(prev);
                next.delete(fullName);
                return next;
            });
        }, 1500);
    }, []);

    const renderItem = React.useCallback(({ item }: { item: RepoInfo }) => {
        const langColor = LANGUAGE_COLORS[item.language] ?? theme.colors.textSecondary;

        // Render creating card with progress bar
        if (isCreatingItem(item)) {
            const progress = getCreatingProgress(item.fullName);
            const stepLabel = getCreatingStepLabel(progress);
            return (
                <View style={styles.creatingCard}>
                    <View style={styles.creatingHeader}>
                        <Text style={styles.creatingTitle}>{item.fullName}</Text>
                        <View style={styles.creatingBadge}>
                            <Text style={styles.creatingBadgeText}>Creating</Text>
                        </View>
                    </View>
                    <Text style={styles.creatingDesc} numberOfLines={2}>{item.description}</Text>
                    <View style={styles.creatingProgressBar}>
                        <View style={[styles.creatingProgressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.creatingStepText}>{stepLabel}</Text>
                </View>
            );
        }

        return (
            <Pressable
                style={styles.card}
                onPress={() => router.push(`/repos/${item.owner}/${item.name}`)}
            >
                <View style={styles.cardHeader}>
                    <Text style={styles.repoName}>{item.fullName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {item.isPrivate && (
                            <View style={styles.privateBadge}>
                                <Text style={styles.privateBadgeText}>Private</Text>
                            </View>
                        )}
                        <Pressable
                            onPress={(e) => {
                                e.stopPropagation();
                                handleSyncRepo(item.fullName);
                            }}
                            hitSlop={8}
                            disabled={syncingRepos.has(item.fullName)}
                            style={{ width: 20, alignItems: 'center' }}
                        >
                            {syncingRepos.has(item.fullName) ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Ionicons name="sync" size={16} color={theme.colors.textSecondary} />
                            )}
                        </Pressable>
                    </View>
                </View>

                <Text style={styles.description} numberOfLines={2}>{item.description}</Text>

                <View style={styles.statsRow}>
                    <View style={styles.stat}>
                        <View style={[styles.languageDot, { backgroundColor: langColor }]} />
                        <Text style={styles.statText}>{item.language}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Ionicons name="star-outline" size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.statText}>{item.stars}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Ionicons name="git-network-outline" size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.statText}>{item.forks}</Text>
                    </View>
                    {item.openIssuesCount > 0 && (
                        <View style={styles.stat}>
                            <Ionicons name="alert-circle-outline" size={13} color={theme.colors.textSecondary} />
                            <Text style={styles.statText}>{item.openIssuesCount}</Text>
                        </View>
                    )}
                </View>

                <Text style={styles.updatedText}>
                    Updated {formatTimeAgo(item.updatedAt)}
                </Text>
            </Pressable>
        );
    }, [router, styles, theme, creatingRepos, creatingProgressMap, isCreatingDoneMap, syncingRepos, handleSyncRepo]);

    const listEmpty = React.useMemo(() => (
        <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={styles.emptyTitle}>{t('lab.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>
                {t('lab.emptySubtitle')}
            </Text>
        </View>
    ), [styles, theme]);

    return (
        <View style={styles.container}>
            <View style={styles.searchContainer}>
                <TextInput
                    style={styles.searchInput}
                    placeholder={t('lab.searchPlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={search}
                    onChangeText={setSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
            </View>

            <FlatList
                data={displayList}
                keyExtractor={(item) => item.fullName}
                renderItem={renderItem}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.textSecondary}
                    />
                }
                contentContainerStyle={[
                    styles.listContent,
                    displayList.length === 0 && { flex: 1 },
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
                ListEmptyComponent={listEmpty}
            />

        </View>
    );
}

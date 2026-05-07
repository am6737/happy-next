import * as React from 'react';
import { View, ScrollView, Pressable, FlatList, TextInput } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import {
    getIssuesForRepo,
    getSessionsForRepo,
    AI_ACTIVITIES,
    type RepoIssue,
    type RepoSession,
} from '@/data/mockRepos';
import {
    ISSUE_FILTERS,
    AI_STATUS_COLORS,
    AI_STATUS_LABELS,
    formatTimeAgo,
    filterIssues,
    type IssueFilter,
} from '@/data/repoUtils';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession } from '@/sync/ops';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        position: 'relative',
    },
    filterBar: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    filterChipText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    filterChipTextActive: {
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
    },
    issueCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        padding: 14,
    },
    issueHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    issueTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    issueNumber: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    labelsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    labelPill: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    labelText: {
        fontSize: 11,
        fontWeight: '600',
    },
    issueMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    issueMetaText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    aiStatusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    aiStatusText: {
        fontSize: 11,
        fontWeight: '600',
    },
    aiPilotButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    aiPilotButtonText: {
        fontSize: 11,
        fontWeight: '600',
    },
    emptyText: {
        textAlign: 'center',
        fontSize: 14,
        color: theme.colors.textSecondary,
        paddingVertical: 40,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginLeft: 14,
    },
    content: {
        padding: 16,
        paddingBottom: 32,
        gap: 12,
    },
}));

export default function RepoIssuesScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const fullName = `${owner}/${repoName}`;
    const issues = getIssuesForRepo(fullName);
    const sessions = getSessionsForRepo(fullName);

    const [issueFilter, setIssueFilter] = React.useState<IssueFilter>('all');
    const [activeSessions, setActiveSessions] = React.useState<RepoSession[]>([]);
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const searchInputRef = React.useRef<TextInput>(null);
    const headerHeight = 90;

    // Set header title and right buttons
    React.useEffect(() => {
        navigation.setOptions({
            headerTitle: () => searchVisible ? (
                <TextInput
                    ref={searchInputRef}
                    style={{ flex: 1, fontSize: 17, color: theme.colors.text, paddingVertical: 0 }}
                    placeholder="Search issues..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoFocus
                    selectionColor="#007AFF"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onBlur={() => {
                        setSearchVisible(false);
                        setSearchQuery('');
                    }}
                />
            ) : (
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.header.tint }}>Issues</Text>
            ),
            headerRight: searchVisible ? undefined : () => (
                <View style={{ flexDirection: 'row', gap: 12, paddingRight: 16, alignItems: 'center' }}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="search-outline" size={22} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={() => router.push(`/repos/${owner}/${repoName}/issue/new`)} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, owner, repoName, theme, router, searchVisible, searchQuery]);

    // Get machines for availability check
    const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;
    const allRegisteredRepos = storage(useShallow((state) => state.registeredRepos)) as Record<string, RegisteredRepo[]>;
    const registeredRepos = React.useMemo(() => {
        return Object.entries(allRegisteredRepos)
            .flatMap(([machineId, repos]: [string, RegisteredRepo[]]) =>
                repos
                    .filter((r) => r.path?.includes(`${owner}/${repoName}`))
                    .map((r) => ({ ...r, machineId }))
            );
    }, [allRegisteredRepos, owner, repoName]);

    const hasAvailableMachine = registeredRepos.some(regRepo => {
        const machine = machines[regRepo.machineId];
        return machine && isMachineOnline(machine);
    });

    const filteredIssues = React.useMemo(() => {
        let result = filterIssues(issues, issueFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter((i) =>
                i.title.toLowerCase().includes(q) ||
                String(i.number).includes(q) ||
                i.author.toLowerCase().includes(q)
            );
        }
        return result;
    }, [issues, issueFilter, searchQuery]);

    const handleAutoPilot = React.useCallback(async (issue: RepoIssue) => {
        if (!hasAvailableMachine) {
            Modal.alert(
                t('repoSettings.noMachineAvailable'),
                t('repoSettings.noMachineAvailableAutoPilot')
            );
            return;
        }

        // Find the first available machine with registered repo
        const availableRegRepo = registeredRepos.find(regRepo => {
            const machine = machines[regRepo.machineId];
            return machine && isMachineOnline(machine);
        });

        if (!availableRegRepo) {
            Modal.alert(
                t('repoSettings.noMachineAvailable'),
                t('repoSettings.noMachineAvailableAutoPilot')
            );
            return;
        }

        const machineId = availableRegRepo.machineId;
        const directory = availableRegRepo.path || `/home/happy/repos/${owner}/${repoName}`;

        // Spawn session with auto-pilot issue context
        const result = await machineSpawnNewSession({
            machineId,
            directory,
            approvedNewDirectoryCreation: true,
            autoPilotIssue: {
                url: `https://github.com/${owner}/${repoName}/issues/${issue.number}`,
                title: issue.title,
                body: issue.body || '',
                number: issue.number,
                owner,
                repo: repoName,
                locale: storage.getState().settings.preferredLanguage || undefined,
            },
        });

        if ('sessionId' in result && result.sessionId) {
            // Add to active sessions
            const sessionId = result.sessionId;
            const newSession: RepoSession = {
                id: sessionId,
                title: `Issue #${issue.number}: ${issue.title.slice(0, 40)}`,
                status: 'active',
                createdAt: new Date().toISOString(),
                issueNumber: issue.number,
                ownerType: 'ai',
                ownerName: 'Happy Agent',
                currentActivity: AI_ACTIVITIES[0],
            };
            setActiveSessions((prev) => {
                if (prev.find((s) => s.id === sessionId)) return prev;
                return [...prev, newSession];
            });
            router.push(`/repos/${owner}/${repoName}/issue/${issue.number}`);
        } else if (result.type === 'error') {
            Modal.alert(
                'Failed to start Auto Pilot',
                result.errorMessage
            );
        }
    }, [owner, repoName, router, hasAvailableMachine, registeredRepos, machines]);

    const renderIssueItem = React.useCallback(({ item }: { item: RepoIssue }) => {
        const statusColor = AI_STATUS_COLORS[item.aiStatus];
        return (
            <Pressable
                style={styles.issueCard}
                onPress={() => router.push(`/repos/${owner}/${repoName}/issue/${item.number}`)}
            >
                <View style={styles.issueHeader}>
                    <Text style={styles.issueNumber}>#{item.number}</Text>
                    <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>
                </View>
                <View style={styles.issueMeta}>
                    <Text style={styles.issueMetaText}>@{item.author} · {formatTimeAgo(item.createdAt)}</Text>
                    {item.aiStatus === 'idle' && item.state === 'open' && (
                        <Pressable
                            style={[styles.aiPilotButton, { backgroundColor: theme.colors.button.primary.background }]}
                            onPress={() => handleAutoPilot(item)}
                        >
                            <Text style={[styles.aiPilotButtonText, { color: theme.colors.button.primary.tint }]}>Auto Pilot</Text>
                        </Pressable>
                    )}
                    {item.aiStatus !== 'idle' && (
                        <View style={[styles.aiStatusBadge, { backgroundColor: `${statusColor}18` }]}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                            <Text style={[styles.aiStatusText, { color: statusColor }]}>{AI_STATUS_LABELS[item.aiStatus]}</Text>
                        </View>
                    )}
                </View>
            </Pressable>
        );
    }, [router, owner, repoName, styles, theme, handleAutoPilot]);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: 'Issues', headerBackTitle: t('common.back') }} />

            {searchVisible && (
                <Pressable
                    style={{ position: 'absolute', top: headerHeight, left: 0, right: 0, bottom: 0, zIndex: 1 }}
                    onPress={() => {
                        searchInputRef.current?.blur();
                        setSearchVisible(false);
                        setSearchQuery('');
                    }}
                />
            )}

            <View style={{ flex: 1 }}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexGrow: 0, flexShrink: 0 }}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
                >
                    {ISSUE_FILTERS.map((f) => {
                        const count = f.key === 'all' ? issues.length
                            : f.key === 'open' ? issues.filter((i) => i.state === 'open').length
                            : f.key === 'ai-running' ? issues.filter((i) => i.aiStatus === 'running').length
                            : issues.filter((i) => i.aiStatus === 'completed').length;
                        return (
                            <Pressable
                                key={f.key}
                                style={[styles.filterChip, issueFilter === f.key && styles.filterChipActive]}
                                onPress={() => setIssueFilter(f.key)}
                            >
                                <Text style={[styles.filterChipText, issueFilter === f.key && styles.filterChipTextActive]}>
                                    {f.label} ({count})
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <View style={[{ marginHorizontal: 16, marginBottom: 16, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surface }]}>
                    <FlatList
                        data={filteredIssues}
                        keyExtractor={(item) => String(item.number)}
                        renderItem={renderIssueItem}
                        ItemSeparatorComponent={() => <View style={styles.divider} />}
                        contentContainerStyle={[
                            { paddingBottom: 24 },
                            filteredIssues.length === 0 && { flex: 1 },
                        ]}
                        ListEmptyComponent={<Text style={styles.emptyText}>No issues match the current filter</Text>}
                    />
                </View>
            </View>
        </View>
    );
}

import * as React from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { AI_ACTIVITIES, type RepoSession } from '@/data/mockRepos';
import { formatTimeAgo } from '@/data/repoUtils';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import {
    machineListClaudeSessions,
    machineListGeminiSessions,
    machineListCodexSessions,
} from '@/sync/ops';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        position: 'relative',
    },
    content: {
        padding: 16,
        paddingBottom: 32,
        gap: 12,
    },
    sessionCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        padding: 14,
    },
    sessionMain: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    sessionIconBox: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sessionContent: {
        flex: 1,
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    sessionMeta: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    activityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        padding: 8,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
    },
    activityText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    joinButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.button.primary.background,
    },
    joinButtonText: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.colors.button.primary.tint,
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
        marginLeft: 62,
    },
}));

export default function RepoSessionsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();
    const headerHeight = 90;

    const [activeSessions, setActiveSessions] = React.useState<RepoSession[]>([]);
    const [machineSessions, setMachineSessions] = React.useState<RepoSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = React.useState(false);
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const searchInputRef = React.useRef<TextInput>(null);

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

    // Fetch sessions from machines that have this repo registered
    React.useEffect(() => {
        if (registeredRepos.length === 0) {
            setMachineSessions([]);
            return;
        }

        let cancelled = false;
        setSessionsLoading(true);

        async function fetchSessions() {
            const allSessions: RepoSession[] = [];

            for (const regRepo of registeredRepos) {
                const machineId = regRepo.machineId;
                const machine = machines[machineId];
                if (!machine || !isMachineOnline(machine)) continue;

                try {
                    // Fetch all three types of sessions in parallel
                    const [claudeResult, geminiResult, codexResult] = await Promise.allSettled([
                        machineListClaudeSessions(machineId, { timeoutMs: 10000 }),
                        machineListGeminiSessions(machineId, { timeoutMs: 10000 }),
                        machineListCodexSessions(machineId, { timeoutMs: 10000 }),
                    ]);

                    // Process Claude sessions
                    if (claudeResult.status === 'fulfilled' && !cancelled) {
                        for (const session of claudeResult.value.sessions) {
                            if (session.originalPath && regRepo.path && session.originalPath.includes(regRepo.path.split('/').pop() || '')) {
                                allSessions.push({
                                    id: session.sessionId,
                                    title: session.title || 'Untitled Session',
                                    status: 'active',
                                    createdAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : new Date().toISOString(),
                                    ownerType: 'ai',
                                    ownerName: 'Happy Agent',
                                });
                            }
                        }
                    }

                    // Process Gemini sessions
                    if (geminiResult.status === 'fulfilled' && !cancelled) {
                        for (const session of geminiResult.value.sessions) {
                            if (session.originalPath && regRepo.path && session.originalPath.includes(regRepo.path.split('/').pop() || '')) {
                                allSessions.push({
                                    id: session.sessionId,
                                    title: session.title || 'Untitled Session',
                                    status: 'active',
                                    createdAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : new Date().toISOString(),
                                    ownerType: 'ai',
                                    ownerName: 'Gemini Agent',
                                });
                            }
                        }
                    }

                    // Process Codex sessions
                    if (codexResult.status === 'fulfilled' && !cancelled) {
                        for (const session of codexResult.value.sessions) {
                            if (session.originalPath && regRepo.path && session.originalPath.includes(regRepo.path.split('/').pop() || '')) {
                                allSessions.push({
                                    id: session.sessionId,
                                    title: session.title || 'Untitled Session',
                                    status: 'active',
                                    createdAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : new Date().toISOString(),
                                    ownerType: 'ai',
                                    ownerName: 'Codex Agent',
                                });
                            }
                        }
                    }
                } catch (error) {
                    // Log but continue with other machines
                    console.warn(`Failed to fetch sessions from machine ${machineId}:`, error);
                }
            }

            if (!cancelled) {
                setMachineSessions(allSessions);
                setSessionsLoading(false);
            }
        }

        fetchSessions();
        return () => { cancelled = true; };
    }, [registeredRepos, machines]);

    const hasAvailableMachine = registeredRepos.some(regRepo => {
        const machine = machines[regRepo.machineId];
        return machine && isMachineOnline(machine);
    });

    const handleNewSession = React.useCallback(() => {
        if (!hasAvailableMachine) {
            Modal.alert(
                t('repoSettings.noMachineAvailable'),
                t('repoSettings.noMachineAvailableNewSession')
            );
            return;
        }
        const newSession: RepoSession = {
            id: `local-${Date.now()}`,
            title: 'Manual session',
            status: 'active',
            createdAt: new Date().toISOString(),
            ownerType: 'user',
            ownerName: 'You',
        };
        setActiveSessions((prev) => [...prev, newSession]);
    }, [hasAvailableMachine]);

    // Set header title (search input or text) and right buttons
    React.useEffect(() => {
        navigation.setOptions({
            headerTitle: () => searchVisible ? (
                <TextInput
                    ref={searchInputRef}
                    style={{ flex: 1, fontSize: 17, color: theme.colors.text, paddingVertical: 0 }}
                    placeholder="Search sessions..."
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
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.header.tint }}>Sessions</Text>
            ),
            headerRight: searchVisible ? undefined : () => (
                <View style={{ flexDirection: 'row', gap: 12, paddingRight: 16, alignItems: 'center' }}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="search-outline" size={22} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={handleNewSession} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, theme, handleNewSession, searchVisible, searchQuery]);

    // Cycle activity text every 3s for active AI sessions
    React.useEffect(() => {
        if (activeSessions.length === 0) return;
        const activityInterval = setInterval(() => {
            setActiveSessions((prev) =>
                prev.map((s) => {
                    if (s.ownerType !== 'ai' || s.status !== 'active') return s;
                    const currentIdx = AI_ACTIVITIES.indexOf(s.currentActivity ?? '');
                    const nextIdx = (currentIdx + 1) % AI_ACTIVITIES.length;
                    return { ...s, currentActivity: AI_ACTIVITIES[nextIdx] };
                })
            );
        }, 3000);
        return () => clearInterval(activityInterval);
    }, [activeSessions.length]);

    // All sessions: machine sessions + active local sessions
    const allSessions = React.useMemo(() => {
        let result = [...activeSessions, ...machineSessions];
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter((s) =>
                s.title.toLowerCase().includes(q) ||
                (s.ownerName?.toLowerCase().includes(q) ?? false)
            );
        }
        return result;
    }, [machineSessions, activeSessions, searchQuery]);

    const renderSessionCard = ({ item }: { item: RepoSession }) => (
        <Pressable key={item.id} style={styles.sessionCard}>
            <View style={styles.sessionMain}>
                <View style={[
                    styles.sessionIconBox,
                    { backgroundColor: item.ownerType === 'ai' ? '#007AFF15' : '#AF52DE15' }
                ]}>
                    <Ionicons
                        name={item.ownerType === 'ai' ? 'sparkles' : 'person'}
                        size={20}
                        color={item.ownerType === 'ai' ? '#007AFF' : '#AF52DE'}
                    />
                </View>

                <View style={styles.sessionContent}>
                    <View style={styles.sessionTitleRow}>
                        <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
                        {item.status === 'active' && (
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' }} />
                        )}
                    </View>
                    <Text style={styles.sessionMeta}>
                        {item.ownerName} · {formatTimeAgo(item.createdAt)}
                        {item.issueNumber ? ` · Issue #${item.issueNumber}` : ''}
                    </Text>
                </View>

                <Pressable
                    style={styles.joinButton}
                    onPress={() => router.push(`/session/${item.id}`)}
                >
                    <Text style={styles.joinButtonText}>
                        {item.ownerType === 'ai' ? 'Auto Pilot' : 'Manual'}
                    </Text>
                </Pressable>
            </View>

            {item.ownerType === 'ai' && item.currentActivity && (
                <View style={styles.activityRow}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} style={{ transform: [{ scale: 0.7 }] }} />
                    <Text style={styles.activityText} numberOfLines={1}>
                        {item.currentActivity}
                    </Text>
                </View>
            )}
        </Pressable>
    );

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: 'Sessions', headerBackTitle: t('common.back') }} />

            <Pressable
                style={{ position: 'absolute', top: headerHeight, left: 0, right: 0, bottom: 0, zIndex: 1 }}
                onPress={() => {
                    searchInputRef.current?.blur();
                    setSearchVisible(false);
                    setSearchQuery('');
                }}
            />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}>
                {allSessions.length === 0 ? (
                    <Text style={styles.emptyText}>No sessions yet for this repository</Text>
                ) : (
                    <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
                        {allSessions.map((session, index) => (
                            <React.Fragment key={session.id}>
                                {renderSessionCard({ item: session })}
                                {index < allSessions.length - 1 && <View style={styles.divider} />}
                            </React.Fragment>
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

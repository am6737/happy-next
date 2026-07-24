import React from 'react';
import { View, Pressable, FlatList, Platform, RefreshControl, ScrollView, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem, useSetting, useOrchestratorRunningTaskCount, useSessionHasDraft } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionSubtitle, getSessionAvatarId, hasUnreadCompletion } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisibleSessionListViewData, useSharedSessionListViewData, useSharedByMeSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useLocalSettingMutable } from '@/sync/storage';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { Item } from './Item';
import { ItemGroup } from './ItemGroup';
import { useHappyAction } from '@/hooks/useHappyAction';
import { sessionDelete } from '@/sync/ops';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { SessionContextMenu } from './SessionContextMenu';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemCompact: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemContainer: {
        marginHorizontal: 16,
        overflow: 'hidden',
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleCompact: {
        fontSize: 15,
        flex: 1,
        ...Typography.default('regular'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    taskStatusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 4,
        height: 16,
        borderRadius: 4,
    },
    taskStatusText: {
        fontSize: 10,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    statusIndicatorsRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        transform: [{ translateY: 1 }],
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 80, // 16px paddingHorizontal + 48px avatar + 16px gap
    },
    filterRow: {
        paddingTop: 16,
        paddingBottom: 0,
    },
    filterRowContent: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 16,
    },
    filterRowWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    filterChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    filterChipInner: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    filterChipText: {
        fontSize: 13,
        maxWidth: 160,
        ...Typography.default(),
    },
    filterChipCornerBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 12,
        height: 12,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        alignItems: 'center',
        paddingTop: 80,
        paddingHorizontal: 48,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));

// 'all' = all active sessions (across every machine, including unknown-machine ones).
// 'shared' / 'sharedByMe' = sharing tabs. Any other value is a machineId tab.
type SessionTab = 'all' | 'shared' | 'sharedByMe' | (string & {});

type TabDot = 'none' | 'attention' | 'thinking' | 'completed';
type TabItem = { key: string; label: string; dot: TabDot; active: boolean };
type SessionRowRef = View | null;
type RegisterSessionRowRef = (sessionId: string, ref: SessionRowRef) => void;

function collectSessions(items: SessionListViewItem[] | null): Session[] {
    const sessions: Session[] = [];
    if (!items) return sessions;
    for (const item of items) {
        if (item.type === 'active-sessions') sessions.push(...item.sessions);
        else if (item.type === 'session') sessions.push(item.session);
    }
    return sessions;
}

function getSessionIdFromPathname(pathname: string): string | null {
    if (!pathname.startsWith('/session/')) return null;
    return pathname.split('/')[2] || null;
}

// Memoized so the tab bar is insulated from the session list's frequent re-renders.
// `tabs` keeps a stable reference until its content changes (see tabItems below), so the
// default shallow compare bails out on session churn. Theme changes still re-render here
// because the useUnistyles subscription fires regardless of the props memo.
const SessionTabBar = React.memo(function SessionTabBar({ tabs, onSelect }: { tabs: TabItem[]; onSelect: (key: SessionTab) => void }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const chips = tabs.map((tab) => {
        const backgroundColor = tab.active
            ? theme.colors.button.primary.background
            : (theme.dark ? '#2f2f2f' : '#e8e8e8');
        return (
            <Pressable
                key={tab.key}
                style={[styles.filterChip, { backgroundColor }]}
                onPress={() => onSelect(tab.key)}
            >
                <View style={styles.filterChipInner}>
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.filterChipText,
                            { color: tab.active ? theme.colors.button.primary.tint : theme.colors.text },
                        ]}
                    >
                        {tab.label}
                    </Text>
                </View>
                {tab.dot !== 'none' && (
                    <View style={[styles.filterChipCornerBadge, { backgroundColor: theme.colors.groupped.background }]}>
                        <StatusDot
                            color={tab.dot === 'attention' ? '#FF9500' : '#007AFF'}
                            isPulsing={tab.dot === 'attention' || tab.dot === 'thinking'}
                            size={8}
                        />
                    </View>
                )}
            </Pressable>
        );
    });
    // Web/desktop: wrap onto multiple lines (no touch gestures to scroll).
    // Mobile: horizontal scroll, swipeable by touch.
    return Platform.OS === 'web' ? (
        <View style={styles.filterRowWrap}>{chips}</View>
    ) : (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterRowContent}
        >
            {chips}
        </ScrollView>
    );
});

export function SessionsList() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const data = useVisibleSessionListViewData();
    const sharedData = useSharedSessionListViewData();
    const sharedByMeData = useSharedByMeSessionListViewData();
    const machineNames = useMachineNameMap();
    // Selected tab is persisted to disk so it survives app restarts.
    const [persistedTab, setPersistedTab] = useLocalSettingMutable('sessionListSelectedTab');
    // machineId -> name cache, so machine tabs keep their labels before machines sync.
    const [machineNameCache, setMachineNameCache] = useLocalSettingMutable('machineNameCache');
    const [activeTab, _setActiveTab] = React.useState<SessionTab>(persistedTab ?? 'all');
    const [pendingSessionNavigationId, setPendingSessionNavigationId] = React.useState<string | null>(null);
    const setActiveTab = React.useCallback((tab: SessionTab) => {
        setPersistedTab(tab);
        _setActiveTab(tab);
    }, [setPersistedTab]);
    const handleSessionTabSelect = React.useCallback((tab: SessionTab) => {
        // A manual tab selection takes precedence over any pending automatic reveal.
        setPendingSessionNavigationId(null);
        setActiveTab(tab);
    }, [setActiveTab]);

    // All active sessions live inside the single 'active-sessions' item produced by buildSessionListViewData.
    const allActiveSessions = React.useMemo(() => {
        const item = data?.find(i => i.type === 'active-sessions');
        return item && item.type === 'active-sessions' ? item.sessions : [];
    }, [data]);

    // Group active sessions by machine. Sessions without a machineId are intentionally
    // excluded here — they only appear in the 'all' tab.
    const machineGroups = React.useMemo(() => {
        const groups = new Map<string, { id: string; name: string; sessions: Session[] }>();
        for (const session of allActiveSessions) {
            const machineId = session.metadata?.machineId;
            if (!machineId) continue;
            let group = groups.get(machineId);
            if (!group) {
                // Prefer the live name, fall back to the persisted cache (so labels show
                // correctly right after a restart, before machines have synced), then UUID.
                const name = machineNames.get(machineId) || machineNameCache[machineId] || machineId;
                group = { id: machineId, name, sessions: [] };
                groups.set(machineId, group);
            }
            group.sessions.push(session);
        }
        return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [allActiveSessions, machineNames, machineNameCache]);
    const hasSharedSessions = (sharedData?.length ?? 0) > 0;
    const showMachineTabs = machineGroups.length >= 2 || hasSharedSessions;

    // Persist live machine names so they survive app restarts (machines sync lazily).
    React.useEffect(() => {
        let changed = false;
        const next = { ...machineNameCache };
        for (const [id, name] of machineNames) {
            if (next[id] !== name) {
                next[id] = name;
                changed = true;
            }
        }
        if (changed) setMachineNameCache(next);
    }, [machineNames, machineNameCache, setMachineNameCache]);
    const pathname = usePathname();
    const selectedSessionId = React.useMemo(() => getSessionIdFromPathname(pathname), [pathname]);
    const previousSelectedSessionIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (previousSelectedSessionIdRef.current === selectedSessionId) return;
        previousSelectedSessionIdRef.current = selectedSessionId;
        setPendingSessionNavigationId(selectedSessionId);
    }, [selectedSessionId]);
    const isTablet = useIsTablet();
    const navigateToSession = useNavigateToSession();
    const compactSessionView = useSetting('compactSessionView');
    const router = useRouter();
    const { theme } = useUnistyles();
    const [refreshing, setRefreshing] = React.useState(false);
    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await sync.refreshSessionsWithReconcile();
        } finally {
            setRefreshing(false);
        }
    }, []);
    // Fall back to 'all' if the current tab is no longer available (e.g. a machine
    // went away, or a sharing tab became empty).
    React.useEffect(() => {
        if (activeTab === 'shared' && sharedData && sharedData.length === 0) {
            setActiveTab('all');
        }
        if (activeTab === 'sharedByMe' && sharedByMeData && sharedByMeData.length === 0) {
            setActiveTab('all');
        }
        // Only fall back once data has loaded — on a fresh restart machineGroups is
        // briefly empty, and we must not discard the persisted machine tab before
        // sessions arrive. Once loaded, drop to 'all' if that machine tab is gone
        // (machine has no active sessions, or there's no longer a machine split).
        const isMachineTab = activeTab !== 'all' && activeTab !== 'shared' && activeTab !== 'sharedByMe';
        if (data !== null && isMachineTab && (!showMachineTabs || !machineGroups.some(g => g.id === activeTab))) {
            setActiveTab('all');
        }
    }, [activeTab, data, sharedData, sharedByMeData, machineGroups, showMachineTabs, setActiveTab]);

    const tabData = React.useMemo(() => {
        if (activeTab === 'shared') return sharedData;
        if (activeTab === 'sharedByMe') return sharedByMeData;
        if (activeTab === 'all') return data;
        const group = machineGroups.find(g => g.id === activeTab);
        return group ? [{ type: 'active-sessions' as const, sessions: group.sessions }] : data;
    }, [activeTab, sharedData, sharedByMeData, data, machineGroups]);

    const sharedSessions = React.useMemo(() => collectSessions(sharedData), [sharedData]);
    const sharedByMeSessions = React.useMemo(() => collectSessions(sharedByMeData), [sharedByMeData]);
    const pendingActiveSession = React.useMemo(
        () => pendingSessionNavigationId ? allActiveSessions.find(session => session.id === pendingSessionNavigationId) : undefined,
        [allActiveSessions, pendingSessionNavigationId],
    );
    const pendingSessionTargetTab = React.useMemo<SessionTab | null>(() => {
        if (!pendingSessionNavigationId) return null;
        if (pendingActiveSession) {
            const machineId = pendingActiveSession.metadata?.machineId;
            if (showMachineTabs && machineId && machineGroups.some(group => group.id === machineId)) {
                return machineId;
            }
            return 'all';
        }
        if (sharedSessions.some(session => session.id === pendingSessionNavigationId)) return 'shared';
        if (sharedByMeSessions.some(session => session.id === pendingSessionNavigationId)) return 'sharedByMe';
        if (collectSessions(data).some(session => session.id === pendingSessionNavigationId)) return 'all';
        return null;
    }, [pendingSessionNavigationId, pendingActiveSession, showMachineTabs, machineGroups, sharedSessions, sharedByMeSessions, data]);
    const activeTabContainsPendingSession = React.useMemo(() => {
        if (!pendingSessionNavigationId) return false;
        if (activeTab === 'all') return collectSessions(data).some(session => session.id === pendingSessionNavigationId);
        if (activeTab === 'shared') return sharedSessions.some(session => session.id === pendingSessionNavigationId);
        if (activeTab === 'sharedByMe') return sharedByMeSessions.some(session => session.id === pendingSessionNavigationId);
        return machineGroups.find(group => group.id === activeTab)?.sessions.some(session => session.id === pendingSessionNavigationId) ?? false;
    }, [pendingSessionNavigationId, activeTab, data, sharedSessions, sharedByMeSessions, machineGroups]);

    // Per-tab dot indicator, mirroring useSessionStatus precedence:
    // 'attention' (needs permission, orange pulse) > 'thinking' (blue pulse) >
    // 'completed' (unread completion, static blue). All are online-only signals.
    // The 'all' tab is an aggregate and intentionally shows no dot.
    const tabDot = React.useMemo(() => {
        const needsAttention = (s: Session) => s.presence === 'online'
            && !!s.agentState?.requests && Object.keys(s.agentState.requests).length > 0;
        const isThinking = (s: Session) => s.presence === 'online' && s.thinking === true;
        const dotFor = (sessions: Session[]): TabDot => {
            if (sessions.some(needsAttention)) return 'attention';
            if (sessions.some(isThinking)) return 'thinking';
            if (sessions.some(hasUnreadCompletion)) return 'completed';
            return 'none';
        };
        const map: Record<string, TabDot> = {
            all: 'none',
            shared: dotFor(collectSessions(sharedData)),
            sharedByMe: dotFor(collectSessions(sharedByMeData)),
        };
        for (const group of machineGroups) {
            map[group.id] = dotFor(group.sessions);
        }
        return map;
    }, [machineGroups, sharedData, sharedByMeData]);

    const selectable = isTablet;
    const dataWithSelected = selectable ? React.useMemo(() => {
        return tabData?.map(item => ({
            ...item,
            selected: selectedSessionId === (item.type === 'session' ? item.session.id : null)
        }));
    }, [tabData, selectedSessionId]) : tabData;

    const listRef = React.useRef<FlatList<SessionListViewItem & { selected?: boolean }> | null>(null);
    const listViewportRef = React.useRef<View | null>(null);
    const sessionRowRefs = React.useRef(new Map<string, View>());
    const scrollOffsetRef = React.useRef(0);
    const revealFrameRef = React.useRef<number | null>(null);
    const registerSessionRowRef = React.useCallback<RegisterSessionRowRef>((sessionId, ref) => {
        if (ref) sessionRowRefs.current.set(sessionId, ref);
        else sessionRowRefs.current.delete(sessionId);
    }, []);
    const revealSessionRow = React.useCallback((sessionId: string): boolean => {
        const row = sessionRowRefs.current.get(sessionId);
        if (!row) return false;

        if (Platform.OS === 'web' && typeof (row as any).scrollIntoView === 'function') {
            (row as any).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return true;
        }

        const viewport = listViewportRef.current;
        if (!viewport) return false;
        row.measureInWindow((_rowX, rowY, _rowWidth, rowHeight) => {
            viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
                const margin = 8;
                const visibleTop = viewportY + margin;
                const visibleBottom = viewportY + viewportHeight - margin;
                const rowBottom = rowY + rowHeight;
                let delta = 0;
                if (rowY < visibleTop) delta = rowY - visibleTop;
                else if (rowBottom > visibleBottom) delta = rowBottom - visibleBottom;
                if (delta !== 0) {
                    listRef.current?.scrollToOffset({
                        offset: Math.max(0, scrollOffsetRef.current + delta),
                        animated: true,
                    });
                }
            });
        });
        return true;
    }, []);
    const scheduleRevealSelectedSession = React.useCallback((sessionId: string) => {
        if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = requestAnimationFrame(() => {
            revealFrameRef.current = null;
            if (revealSessionRow(sessionId)) return;

            const topLevelIndex = dataWithSelected?.findIndex(item =>
                item.type === 'session'
                    ? item.session.id === sessionId
                    : item.type === 'active-sessions' && item.sessions.some(session => session.id === sessionId)
            ) ?? -1;
            if (topLevelIndex < 0) return;

            listRef.current?.scrollToIndex({ index: topLevelIndex, animated: false, viewPosition: 0.5 });
            revealFrameRef.current = requestAnimationFrame(() => {
                revealFrameRef.current = null;
                revealSessionRow(sessionId);
            });
        });
    }, [dataWithSelected, revealSessionRow]);

    // Process each route-driven session change once. Realtime list updates must not
    // repeatedly reveal the same session after the user has manually scrolled away.
    React.useEffect(() => {
        if (!pendingSessionNavigationId || !pendingSessionTargetTab) return;
        if (!activeTabContainsPendingSession) {
            if (activeTab !== pendingSessionTargetTab) setActiveTab(pendingSessionTargetTab);
            return;
        }
        scheduleRevealSelectedSession(pendingSessionNavigationId);
        setPendingSessionNavigationId(null);
    }, [pendingSessionNavigationId, pendingSessionTargetTab, activeTabContainsPendingSession, activeTab, setActiveTab, scheduleRevealSelectedSession]);

    React.useEffect(() => () => {
        if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    }, []);

    // Request review
    React.useEffect(() => {
        if (data && data.length > 0) {
            requestReview();
        }
    }, [data && data.length > 0]);

    // Early return if no data yet
    if (!data) {
        return (
            <View style={styles.container} />
        );
    }

    const keyExtractor = React.useCallback((item: SessionListViewItem & { selected?: boolean }, index: number) => {
        switch (item.type) {
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item, index }: { item: SessionListViewItem & { selected?: boolean }, index: number }) => {
        switch (item.type) {
            case 'header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                // Extract just the session ID from pathname (e.g., /session/abc123/file -> abc123)
                let selectedId: string | undefined;
                if (isTablet && selectedSessionId) selectedId = selectedSessionId;

                const ActiveComponent = compactSessionView ? ActiveSessionsGroupCompact : ActiveSessionsGroup;
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                return (
                    <SessionItem
                        session={item.session}
                        selected={item.selected}
                        isFirst={isFirst}
                        isLast={isLast}
                        isSingle={isSingle}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                );
        }
    }, [isTablet, selectedSessionId, dataWithSelected, compactSessionView, registerSessionRowRef]);


    // Remove this section as we'll use FlatList for all items now


    const hasSharedByMeSessions = sharedByMeData && sharedByMeData.length > 0;

    // Tab bar: one tab per machine when there are 2+ machines, or when shared-with-me
    // sessions are present so users can distinguish their own machine from shared sources.
    // The tabs are preceded by an
    // "All" tab, then the sharing tabs. The "All" tab is also added when only sharing
    // tabs exist, so the user can always get back to the main active list.
    const visibleTabs = React.useMemo(() => {
        const result: { key: SessionTab; label: string }[] = [];
        if (showMachineTabs) {
            result.push({ key: 'all', label: t('session.tabs.all') });
            for (const group of machineGroups) {
                result.push({ key: group.id, label: group.name });
            }
        }
        if (hasSharedSessions) result.push({ key: 'shared', label: t('session.sharing.sharedWithMeSessions') });
        if (hasSharedByMeSessions) result.push({ key: 'sharedByMe', label: t('session.sharing.sharedByMeSessions') });
        if (!showMachineTabs && result.length > 0) {
            result.unshift({ key: 'all', label: t('session.tabs.all') });
        }
        return result;
    }, [showMachineTabs, machineGroups, hasSharedSessions, hasSharedByMeSessions]);

    // Flattened, primitive-only tab descriptors. The upstream list churns its identity on
    // every session realtime update, so we key the memo off a content signature: tabItems
    // keeps a stable reference until the actual tab content changes. That in turn keeps
    // HeaderComponent stable, so FlatList doesn't remount (and thus re-render) the tab bar.
    const tabsSignature = visibleTabs.map((tab) => `${tab.key}|${tab.label}|${tabDot[tab.key] ?? 'none'}|${activeTab === tab.key ? 1 : 0}`).join(',');
    const tabItems = React.useMemo<TabItem[]>(() => visibleTabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        dot: tabDot[tab.key] ?? 'none',
        active: activeTab === tab.key,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [tabsSignature]);

    const HeaderComponent = React.useCallback(() => (
        <>
            {tabItems.length > 1 && (
                <SessionTabBar tabs={tabItems} onSelect={handleSessionTabSelect} />
            )}
        </>
    ), [tabItems, handleSessionTabSelect]);

    const EmptyComponent = React.useCallback(() => (
        <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12, opacity: 0.5 }} />
            <Text style={styles.emptyText}>
                {t('components.emptySessions.noActiveSessions')}
            </Text>
        </View>
    ), [theme]);

    return (
        <View style={styles.container}>
            <View ref={listViewportRef} style={styles.contentContainer}>
                <FlatList
                    ref={listRef}
                    contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                    data={dataWithSelected}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ paddingBottom: safeArea.bottom + 128, maxWidth: layout.maxWidth }}
                    ListHeaderComponent={HeaderComponent}
                    ListEmptyComponent={EmptyComponent}
                    removeClippedSubviews={true}
                    onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                        scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                    onScrollToIndexFailed={({ index, averageItemLength }) => {
                        listRef.current?.scrollToOffset({
                            offset: Math.max(0, index * averageItemLength),
                            animated: false,
                        });
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.textSecondary}
                        />
                    }
                />
            </View>
        </View>
    );
}

// Sub-component that handles session message logic
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle, registerSessionRowRef }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    registerSessionRowRef?: RegisterSessionRowRef;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const compactSessionView = useSetting('compactSessionView');
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const navigateToSession = useNavigateToSession();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    const setRowRef = React.useCallback((ref: View | null) => {
        registerSessionRowRef?.(session.id, ref);
    }, [registerSessionRowRef, session.id]);

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    const itemContent = (
        <SessionContextMenu session={session}>
            <Pressable
                style={[
                compactSessionView ? styles.sessionItemCompact : styles.sessionItem,
                selected && styles.sessionItemSelected,
                isSingle ? styles.sessionItemSingle :
                    isFirst ? styles.sessionItemFirst :
                        isLast ? styles.sessionItemLast : {}
            ]}
            onPress={() => {
                navigateToSession(session.id);
            }}
        >
            {!compactSessionView && (
                <View style={styles.avatarContainer}>
                    <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
                    {hasDraft && (
                        <View style={styles.draftIconContainer}>
                            <Ionicons
                                name="create-outline"
                                size={12}
                                style={styles.draftIconOverlay}
                            />
                        </View>
                    )}
                </View>
            )}
            <View style={[styles.sessionContent, compactSessionView && { marginLeft: 0 }]}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text style={[
                        compactSessionView ? styles.sessionTitleCompact : styles.sessionTitle,
                        sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={1} ref={(el: any) => {
                        if (Platform.OS === 'web' && el) {
                            el.title = sessionName;
                        }
                    }}>
                        {sessionName}
                    </Text>
                </View>

                {!compactSessionView && (
                    <>
                        {/* Subtitle line */}
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {sessionSubtitle}
                        </Text>

                        {/* Status line with dot */}
                        <View style={styles.statusRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.statusDotContainer}>
                                    <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                                </View>
                                <Text style={[
                                    styles.statusText,
                                    { color: sessionStatus.statusColor }
                                ]}>
                                    {sessionStatus.statusText}
                                </Text>
                            </View>

                            {(runningTaskCount > 0 || session.ownerProfile || session.isShared) && (
                                <View style={styles.statusIndicatorsRight}>
                                    {runningTaskCount > 0 && !compactSessionView && (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="layers-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                                style={{ marginRight: 2 }}
                                            />
                                            <Text style={styles.taskStatusText}>
                                                {runningTaskCount > 99 ? '99+' : runningTaskCount}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Shared status indicator */}
                                    {session.ownerProfile ? (
                                        <Avatar id={session.ownerProfile.id} size={18} imageUrl={session.ownerProfile.avatar ?? undefined} />
                                    ) : session.isShared ? (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="share-social-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                            />
                                        </View>
                                    ) : null}
                                </View>
                            )}
                        </View>
                    </>
                )}
            </View>
            </Pressable>
        </SessionContextMenu>
    );

    const containerStyles = [
        styles.sessionItemContainer,
        isSingle ? styles.sessionItemContainerSingle :
            isFirst ? styles.sessionItemContainerFirst :
                isLast ? styles.sessionItemContainerLast : {}
    ];

    const showDivider = !isLast && !isSingle;
    const dividerStyle = compactSessionView
        ? [styles.sessionDivider, { marginLeft: 16 }]
        : styles.sessionDivider;

    if (!swipeEnabled) {
        return (
            <View ref={setRowRef} style={containerStyles}>
                {itemContent}
                {showDivider && <View style={dividerStyle} />}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleDelete}
            disabled={deletingSession}
        >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.deleteSession')}
            </Text>
        </Pressable>
    );

    return (
        <View ref={setRowRef} style={containerStyles}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!deletingSession}
            >
                {itemContent}
            </Swipeable>
            {showDivider && <View style={dividerStyle} />}
        </View>
    );
});

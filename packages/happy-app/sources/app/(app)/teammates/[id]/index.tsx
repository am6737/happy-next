import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { storage, useMachine, useTeammate } from '@/sync/storage';
import { getMachineDisplayName } from '@/components/sessionListScope';
import { isMachineOnline } from '@/utils/machineUtils';
import { computeTeammateStats } from '@/sync/teammateStats';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { buildTeammateTimeline } from '@/sync/teammateTimeline';
import { getTeammateWorkload } from '@/sync/teammateWorkload';
import { useTeammateProfile } from '@/hooks/useTeammateProfile';
import { useTeammateActions } from '@/hooks/useTeammateActions';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useTickingNow } from '@/hooks/useTickingNow';
import { TeammateAvatar, TeammateLoadFallback } from '@/components/teammates/ui';
import { Card, FieldError, KIT_PAGE_PADDING, PillButton, StatusDot } from '@/components/teammates/kit';
import { useTeammateSheet } from '@/components/teammates/TeammateSheet';
import { TeammateRunSheet } from '@/components/teammates/TeammateRunSheet';
import { TeammateTaskList, TeammateTimeline } from '@/components/teammates/TeammateActivity';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { formatTeammateMoney, formatTeammateTokens, totalTeammateTokens } from '@/utils/teammateUsageFormat';

type Tab = 'activity' | 'tasks';

function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const clock = `${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    return hours ? `${hours}:${clock}` : clock;
}

/**
 * Agent profile as a workspace: who it is and how to reach it, what it is doing right now, how this month is
 * going, then its activity feed and tasks. Settings live on the edit page (header "Edit").
 */
export default React.memo(function TeammateProfileScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const { theme } = useUnistyles();
    const teammate = useTeammate(id);
    const runs = storage(state => state.teammateRuns[id]);
    const tasks = storage(state => state.teammateTasks[id]);
    const spend = storage(state => state.teammateSpend[id]);
    const machine = useMachine(teammate?.machineId ?? '');
    const { loading, error, refresh } = useTeammateProfile(id);
    const actions = useTeammateActions(teammate);
    const runSheet = useTeammateSheet();
    const [tab, setTab] = React.useState<Tab>('activity');
    const [menuOpen, setMenuOpen] = React.useState(false);
    const liveRun = runs?.filter(isTeammateRunCancellable).sort((a, b) => b.queuedAt - a.queuedAt)[0];
    const now = useTickingNow(!!liveRun);
    const timeline = React.useMemo(() => buildTeammateTimeline(runs, tasks), [runs, tasks]);

    if (!teammate) return <TeammateLoadFallback loading={loading} error={error} refresh={refresh} />;

    const status = teammate.status;
    const isActive = status === 'active';
    const editPath = `/teammates/${encodeURIComponent(id)}/edit` as const;
    const online = !!machine && isMachineOnline(machine);
    const workload = getTeammateWorkload(teammate, runs, tasks);
    const statusText = online || !isActive ? t(`teammates.${workload}`) : t('teammates.offline');
    const machineName = machine ? getMachineDisplayName(machine, machine.id, {}) : null;
    const statusColor = !isActive ? theme.colors.box.warning.text : online ? theme.colors.status.connected : theme.colors.textSecondary;

    const budget = spend ? spend.budgetUsd : teammate.monthlyBudgetUsd;
    const spent = spend?.spentUsd ?? null;
    const remaining = budget !== null && spent !== null ? Math.max(0, budget - spent) : null;
    const stats = computeTeammateStats(runs, 30, now);
    const tokens = spend?.tokens;
    const tokenBreakdown = tokens ? [
        t('teammates.detail.uncachedInput', { count: formatTeammateTokens(tokens.input) }),
        t('teammates.detail.cacheRead', { count: formatTeammateTokens(tokens.cacheRead) }),
        ...(tokens.cacheWrite > 0 ? [t('teammates.detail.cacheWrite', { count: formatTeammateTokens(tokens.cacheWrite) })] : []),
        t('teammates.detail.output', { count: formatTeammateTokens(tokens.output) }),
    ].join('  ') : null;

    const liveTask = liveRun?.taskId ? tasks?.find(task => task.id === liveRun.taskId) : undefined;
    const openLive = liveRun?.sessionId ? () => navigateToSession(liveRun.sessionId!)
        : liveTask ? () => router.push(`/teammates/tasks/${encodeURIComponent(liveTask.id)}`) : undefined;

    const menuItems: ActionMenuItem[] = [
        ...(liveRun ? [{ label: t('teammates.cancelRun'), destructive: true, onPress: () => void actions.cancelRun(liveRun) }] : []),
        ...(isActive ? [{ label: t('teammates.pause'), onPress: () => actions.setPaused(true) }] : []),
        { label: t('teammates.archive'), destructive: true, onPress: () => void actions.archive() },
    ];

    return (
        <View style={styles.page}>
            <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
                <TeammateAvatar teammate={teammate} size={56} />
                <Text style={styles.name} numberOfLines={2}>{teammate.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{teammate.role.split(/[：:]/)[0].trim()}</Text>
                <View style={styles.status}>
                    <StatusDot color={statusColor} />
                    <Text style={styles.statusText} numberOfLines={1}>{statusText}</Text>
                    {machineName && <Text style={[styles.statusText, styles.machineName]} numberOfLines={1}>{machineName}</Text>}
                </View>

                {status === 'archived' ? (
                    <Text style={styles.archived}>{t('teammates.detail.archivedNote')}</Text>
                ) : (
                    <View style={styles.actions}>
                        {status === 'paused' && <PillButton grow label={t('teammates.resume')} disabled={actions.busy || !actions.canAct} onPress={() => actions.setPaused(false)} />}
                        <PillButton grow kind={status === 'paused' ? 'secondary' : 'primary'} label={t('teammates.message')} disabled={actions.busy || !actions.canAct} onPress={actions.message} />
                        {isActive && <PillButton grow kind="secondary" label={t('teammates.detail.run')} disabled={!actions.canAct} onPress={runSheet.present} />}
                        <PillButton kind="icon" icon="ellipsis-horizontal" label={t('teammates.detail.more')} disabled={actions.busy} onPress={() => setMenuOpen(true)} />
                    </View>
                )}

                {(error || actions.error) && <View style={styles.notice}>
                    <FieldError message={actions.error || error} />
                    {error && !actions.error && <Pressable accessibilityRole="button" onPress={refresh}><Text style={styles.link}>{t('common.retry')}</Text></Pressable>}
                </View>}

                {status === 'budget_paused' && (
                    <Pressable accessibilityRole="button" onPress={() => router.push(`${editPath}?focus=schedule`)}
                        style={({ pressed }) => [styles.banner, styles.budgetBanner, pressed && styles.pressed]}>
                        <View style={styles.bannerBody}>
                            <Text style={[styles.bannerTitle, styles.budgetText]}>{t('teammates.budgetPausedBanner')}</Text>
                            <Text style={styles.bannerDetail}>{t('teammates.budgetAutoResume')}</Text>
                        </View>
                        <Text style={[styles.link, styles.budgetText]}>{t('teammates.raiseBudget')}</Text>
                    </Pressable>
                )}

                {liveRun && (
                    <Pressable accessibilityRole="button" accessibilityHint={t('teammates.cancelRun')} disabled={!openLive && !actions.canAct}
                        onPress={openLive} onLongPress={() => void actions.cancelRun(liveRun)}
                        style={({ pressed }) => [styles.banner, styles.liveBanner, pressed && styles.pressed]}>
                        <StatusDot color={theme.colors.status.connected} size={8} />
                        <View style={styles.bannerBody}>
                            <Text style={styles.bannerTitle} numberOfLines={1}>{liveTask?.title ?? t(`teammates.trigger.${liveRun.trigger}`)}</Text>
                            <View style={styles.bannerMeta}>
                                <Text style={styles.bannerDetail} numberOfLines={1}>{t(`teammates.runStatus.${liveRun.status}`)}</Text>
                                {openLive && <Text style={styles.bannerDetail} numberOfLines={1}>{`${t('teammates.openSession')} ›`}</Text>}
                            </View>
                        </View>
                        <Text style={styles.elapsed}>{formatElapsed(now - (liveRun.startedAt ?? liveRun.queuedAt))}</Text>
                    </Pressable>
                )}

                <Card style={styles.stats}>
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{tokens ? t('teammates.detail.tokenCount', { count: formatTeammateTokens(totalTeammateTokens(tokens)) }) : '—'}</Text>
                        <Text style={styles.statLabel}>{budget !== null ? t('teammates.detail.monthOf', { budget: formatTeammateMoney(budget) }) : t('teammates.detail.thisMonth')}</Text>
                        {spent !== null && <Text style={styles.statLabel}>{t('teammates.detail.estimatedCost', { amount: formatTeammateMoney(spent) })}</Text>}
                        {tokenBreakdown && <Text style={styles.statLabel}>{tokenBreakdown}</Text>}
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{stats.runCount}</Text>
                        <Text style={styles.statLabel}>
                            {stats.failedCount ? t('teammates.detail.runs30Failed', { count: stats.failedCount }) : t('teammates.detail.runs30')}
                        </Text>
                    </View>
                </Card>

                <View accessibilityRole="tablist" style={styles.tabs}>
                    {(['activity', 'tasks'] as const).map(value => (
                        <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)}
                            style={[styles.tab, tab === value && styles.tabActive]}>
                            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
                                {t(value === 'activity' ? 'teammates.detail.tabActivity' : 'teammates.detail.tabTasks')}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'activity' && (timeline.length ? <TeammateTimeline days={timeline} /> : !liveRun && (isActive ? (
                    <Pressable accessibilityRole="button" onPress={runSheet.present} style={({ pressed }) => [styles.firstTask, pressed && styles.pressed]}>
                        <Text style={[styles.bannerTitle, styles.firstTaskTitle]}>{t('teammates.detail.firstTask')}</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                ) : <Text style={styles.empty}>{t('teammates.noRuns')}</Text>))}
                {tab === 'tasks' && <TeammateTaskList tasks={tasks ?? []} />}
            </ScrollView>

            <TeammateRunSheet ref={runSheet.ref} teammateId={id} remainingUsd={remaining} />
            <ActionMenuModal deferItemPress visible={menuOpen} items={menuItems} onClose={() => setMenuOpen(false)} />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 12,
        paddingBottom: 48,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 24,
        color: theme.colors.text,
        marginTop: 16,
    },
    meta: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 12,
    },
    statusText: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    machineName: {
        marginLeft: 6,
    },
    archived: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 24,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 24,
    },
    notice: {
        gap: 6,
        marginTop: 16,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 28,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: 18,
    },
    liveBanner: {
        backgroundColor: `${theme.colors.status.connected}1A`,
    },
    budgetBanner: {
        backgroundColor: theme.colors.box.warning.background,
    },
    budgetText: {
        color: theme.colors.box.warning.text,
    },
    bannerBody: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    bannerTitle: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    bannerMeta: {
        flexDirection: 'row',
        gap: 10,
    },
    bannerDetail: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    elapsed: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    stats: {
        flexDirection: 'row',
        marginTop: 12,
        paddingVertical: 16,
    },
    stat: {
        flex: 1,
        gap: 4,
    },
    statValue: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        fontVariant: ['tabular-nums'],
    },
    statLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    tabs: {
        flexDirection: 'row',
        gap: 28,
        marginTop: 32,
    },
    tab: {
        paddingBottom: 10,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabActive: {
        borderBottomColor: theme.colors.text,
    },
    tabText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
    },
    tabTextActive: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    firstTask: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 24,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    firstTaskTitle: {
        flex: 1,
    },
    empty: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 40,
    },
    pressed: {
        opacity: 0.7,
    },
}));

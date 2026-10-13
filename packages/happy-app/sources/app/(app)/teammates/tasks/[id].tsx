import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TEAMMATE_TASK_ACTIVE_STATUSES, type TeammateRun } from 'happy-wire';
import type { Session } from '@/sync/storageTypes';
import { storage, useMachine, useSession } from '@/sync/storage';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { getMachineDisplayName } from '@/components/sessionListScope';
import { useTeammateTask } from '@/hooks/useTeammateTask';
import { useTeammateTaskActions } from '@/hooks/useTeammateTaskActions';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useTickingNow } from '@/hooks/useTickingNow';
import { Card, KIT_PAGE_PADDING, PillButton, SectionLabel, StatusDot } from '@/components/teammates/kit';
import { formatElapsed, useRunStatusColor, useTaskStatusColor } from '@/components/teammates/TeammateTask';
import { TeammateAvatar } from '@/components/teammates/ui';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { Avatar } from '@/components/Avatar';
import { formatLastSeen, getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';

const money = (amount: number) => `$${amount.toFixed(2)}`;

function RunRow({ run, now, onOpen }: { run: TeammateRun; now: number; onOpen: (sessionId: string) => void }) {
    const { theme } = useUnistyles();
    const color = useRunStatusColor(run.status);
    const duration = formatElapsed((run.finishedAt ?? now) - (run.startedAt ?? run.queuedAt));
    return (
        <Pressable accessibilityRole={run.sessionId ? 'button' : undefined} accessibilityLabel={`${t(`teammates.trigger.${run.trigger}`)} ${t(`teammates.runStatus.${run.status}`)}`}
            disabled={!run.sessionId} onPress={() => run.sessionId && onOpen(run.sessionId)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.rowBody}>
                <View style={styles.inline}>
                    <StatusDot color={color} />
                    <Text style={styles.rowTitle} numberOfLines={1}>{t(`teammates.trigger.${run.trigger}`)}</Text>
                </View>
                <View style={styles.meta}>
                    <Text style={styles.rowDetail}>{formatLastSeen(run.queuedAt)}</Text>
                    {run.costUsd !== null && <Text style={styles.rowDetail}>{money(run.costUsd)}</Text>}
                </View>
                {run.failureReason && <Text style={styles.failure}>{t(`teammates.failure.${run.failureReason}`)}</Text>}
            </View>
            <Text style={styles.duration}>{duration}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} style={!run.sessionId && styles.hidden} />
        </Pressable>
    );
}

function SessionAvatar({ session }: { session: Session }) {
    const status = useSessionStatus(session);
    return (
        <Avatar id={getSessionAvatarId(session)} size={36} monochrome={!status.isConnected} flavor={session.metadata?.flavor}
            sessionIcon={session.metadata?.sessionIcon} />
    );
}

/** A worker session: its avatar and title, as in the session list. */
function WorkerRow({ sessionId, fallbackTitle, onOpen }: { sessionId: string; fallbackTitle: string; onOpen: (sessionId: string) => void }) {
    const { theme } = useUnistyles();
    const session = useSession(sessionId);
    return (
        <Pressable accessibilityRole="button" onPress={() => onOpen(sessionId)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            {session ? <SessionAvatar session={session} /> : <Avatar id={sessionId} size={36} monochrome />}
            <Text style={[styles.rowTitle, styles.rowBody]} numberOfLines={1}>
                {session ? getSessionName(session) : fallbackTitle}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

/**
 * One delegated task: what it is and where it stands, the actions that fit its status, the Agent that owns
 * it, every run with its duration and cost, and the worker sessions doing the work.
 */
export default React.memo(function TeammateTaskScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const openSession = useNavigateToSession();
    const detail = useTeammateTask(id);
    const teammate = storage(state => detail ? state.teammates[detail.task.teammateId] : undefined);
    const creator = storage(state => detail?.task.createdByTeammateId ? state.teammates[detail.task.createdByTeammateId] : undefined);
    const machine = useMachine(teammate?.machineId ?? '');
    const workers = React.useMemo(() => detail?.sessions.filter(session => session.role === 'worker') ?? [], [detail]);
    const actions = useTeammateTaskActions(id, detail?.task.prUrl);
    const statusColor = useTaskStatusColor(detail?.task.status ?? 'todo');
    const [menuOpen, setMenuOpen] = React.useState(false);
    const now = useTickingNow(detail?.runs.some(isTeammateRunCancellable) ?? false);

    if (!detail) {
        return (
            <View style={[styles.page, styles.loading]}>
                <ActivityIndicator />
            </View>
        );
    }

    const { task } = detail;
    const active = (TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status);
    const paused = task.status === 'paused';
    const runs = [...detail.runs].sort((a, b) => b.queuedAt - a.queuedAt);
    const cost = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    const toggle = active
        ? { label: t('teammateTasks.stop'), onPress: actions.pause, loading: actions.pausing }
        : paused ? { label: t('teammates.resume'), onPress: actions.resume, loading: actions.resuming } : null;

    return (
        <View style={styles.page}>
            <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
                <Text style={styles.title}>{task.title}</Text>
                <View style={styles.status}>
                    <View style={styles.inline}>
                        <StatusDot color={statusColor} />
                        <Text style={styles.muted}>{t(`teammates.taskStatus.${task.status}`)}</Text>
                    </View>
                    {task.createdByTeammateId && (
                        <Text style={styles.muted} numberOfLines={1}>
                            {t('teammateTasks.createdByAgent', { agent: creator ? creator.name : t('channels.unknownAgent') })}
                        </Text>
                    )}
                </View>
                {!!task.summary && <Text style={styles.summary}>{task.summary}</Text>}

                {(task.prUrl || toggle) && (
                    <View style={styles.actions}>
                        {task.prUrl && <PillButton grow label={t('teammateTasks.pr')} loading={actions.openingPr} onPress={actions.openPr} />}
                        {toggle && (
                            <PillButton grow kind={task.prUrl ? 'secondary' : 'primary'} label={toggle.label} loading={toggle.loading}
                                disabled={actions.busy || !actions.canAct} onPress={toggle.onPress} />
                        )}
                        {toggle && (
                            <PillButton kind="icon" icon="ellipsis-horizontal" label={t('teammates.detail.more')} disabled={actions.busy || !actions.canAct}
                                onPress={() => setMenuOpen(true)} />
                        )}
                    </View>
                )}

                <SectionLabel title={t('teammateTasks.owner')} />
                <Card>
                    <Pressable accessibilityRole="button" disabled={!teammate} onPress={() => teammate && router.push(`/teammates/${encodeURIComponent(teammate.id)}`)}
                        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                        <TeammateAvatar teammate={teammate ?? { avatar: null }} size={36} />
                        <View style={styles.rowBody}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{teammate?.name ?? t('channels.unknownAgent')}</Text>
                            {teammate && (
                                <View style={styles.meta}>
                                    <Text style={styles.rowDetail} numberOfLines={1}>{teammate.role.split(/[：:]/)[0].trim()}</Text>
                                    {machine && <Text style={styles.rowDetail} numberOfLines={1}>{getMachineDisplayName(machine, machine.id, {})}</Text>}
                                </View>
                            )}
                        </View>
                        {teammate && <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />}
                    </Pressable>
                </Card>

                <SectionLabel title={t('teammateTasks.log')} detail={runs.length ? t('teammateTasks.runSummary', { count: runs.length, cost: money(cost) }) : undefined} />
                {runs.length ? (
                    <Card>
                        {runs.map(run => <RunRow key={run.id} run={run} now={now} onOpen={openSession} />)}
                    </Card>
                ) : (
                    <Text style={styles.empty}>{t('teammates.noRuns')}</Text>
                )}

                {workers.length > 0 && (
                    <>
                        <SectionLabel title={t('teammateTasks.execution')} />
                        <Card>
                            {workers.map((session, index) => (
                                <WorkerRow key={session.sessionId} sessionId={session.sessionId} onOpen={openSession}
                                    fallbackTitle={`${t('teammateTasks.execution')} ${index + 1}`} />
                            ))}
                        </Card>
                    </>
                )}
            </ScrollView>

            <ActionMenuModal deferItemPress visible={menuOpen} onClose={() => setMenuOpen(false)}
                items={[{ label: t('teammateTasks.cancel'), destructive: true, onPress: actions.cancel }]} />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    loading: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 12,
        paddingBottom: 48,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 22,
        lineHeight: 29,
        color: theme.colors.text,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 14,
        rowGap: 4,
        marginTop: 10,
    },
    inline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    muted: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    summary: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
        marginTop: 14,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 20,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 50,
        paddingVertical: 12,
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
    },
    rowTitle: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 15,
        color: theme.colors.text,
    },
    meta: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 3,
    },
    rowDetail: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    failure: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textDestructive,
        marginTop: 3,
    },
    duration: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    hidden: {
        opacity: 0,
    },
    empty: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        paddingHorizontal: 4,
    },
    pressed: {
        opacity: 0.7,
    },
}));

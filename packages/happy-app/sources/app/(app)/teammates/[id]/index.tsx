import React from 'react';
import { ActivityIndicator, RefreshControl, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TEAMMATE_BUDGET_WARNING_RATIO, type TeammateRun } from 'happy-wire';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { storage, useMachine, useTeammate } from '@/sync/storage';
import { useMachineSkills } from '@/hooks/useMachineSkills';
import { getMachineDisplayName } from '@/components/sessionListScope';
import { isMachineOnline } from '@/utils/machineUtils';
import { archiveTeammate, updateTeammate, startTeammateRun, cancelTeammateRun, triggerHeartbeat, triggerDreaming } from '@/sync/apiTeammates';
import { isVisibleTeammateRun } from '@/sync/teammateRunVisibility';
import { computeTeammateStats, type TeammateStatsRange } from '@/sync/teammateStats';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useTeammateProfile } from '@/hooks/useTeammateProfile';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useTickingNow } from '@/hooks/useTickingNow';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { styles as shared, TeammateAvatar, TeammateAvailability, TeammateLoadFallback, useTeammateRuntimeText, teammateErrorMessage } from '@/components/teammates/ui';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';

function RuntimeItem({ title, onPress, ...runtime }: Parameters<typeof useTeammateRuntimeText>[0] & { title: string; onPress?: () => void }) {
    const summary = useTeammateRuntimeText(runtime);
    return <Item title={title} subtitle={summary} subtitleLines={0} onPress={onPress} showChevron={!!onPress} />;
}

function ActionButton({ icon, label, onPress, disabled, primary }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
    const { theme } = useUnistyles();
    const color = primary ? theme.colors.button.primary.tint : theme.colors.button.primary.background;
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.actionButton, primary && styles.actionPrimary, disabled && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name={icon} size={18} color={color} />
        <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>;
}

function Segmented<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
    return <View accessibilityRole="tablist" style={styles.segmented}>
        {options.map(option => <Pressable key={String(option.value)} accessibilityRole="tab" accessibilityState={{ selected: option.value === value }} onPress={() => onChange(option.value)}
            style={[styles.segment, option.value === value && styles.segmentActive]}>
            <Text style={[styles.segmentText, option.value === value && styles.segmentTextActive]} numberOfLines={1}>{option.label}</Text>
        </Pressable>)}
    </View>;
}

function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

type Tab = 'profile' | 'activity' | 'stats';

export default React.memo(function TeammateProfileScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const { theme } = useUnistyles();
    const { credentials } = useAuth();
    const teammate = useTeammate(id);
    const runs = storage(state => state.teammateRuns[id]);
    const tasks = storage(state => state.teammateTasks[id]);
    const spend = storage(state => state.teammateSpend[id]);
    const { loading, error, refresh } = useTeammateProfile(id);
    const [busy, setBusy] = React.useState(false);
    const [actionError, setActionError] = React.useState<string | null>(null);
    const [note, setNote] = React.useState('');
    const [tab, setTab] = React.useState<Tab>('profile');
    const [range, setRange] = React.useState<TeammateStatsRange>(30);
    const [expanded, setExpanded] = React.useState(false);
    const machine = useMachine(teammate?.machineId ?? '');
    const machineSkills = useMachineSkills(teammate?.machineId);
    const liveRun = runs?.filter(isTeammateRunCancellable).sort((a, b) => b.queuedAt - a.queuedAt)[0];
    const now = useTickingNow(!!liveRun);
    const trigger = (start: typeof triggerHeartbeat) => async () => {
        if (!credentials || teammate?.status !== 'active') return;
        try { storage.getState().applyTeammateRun((await start(credentials, id)).run); }
        catch (error) { setActionError(teammateErrorMessage(error)); }
    };
    const [heartbeatBusy, heartbeatNow] = useHappyAction(trigger(triggerHeartbeat));
    const [dreamingBusy, dreamingNow] = useHappyAction(trigger(triggerDreaming));
    /** Runs one profile action at a time; failures show inline. */
    const withBusy = async (work: () => Promise<void>, errorMessage = teammateErrorMessage) => {
        setBusy(true); setActionError(null);
        try { await work(); }
        catch (error) { setActionError(errorMessage(error)); }
        finally { setBusy(false); }
    };
    const runNow = () => {
        if (!credentials || !teammate || teammate.status !== 'active' || busy) return;
        return withBusy(async () => {
            const { run } = await startTeammateRun(credentials, id, { ...(note.trim() ? { note: note.trim() } : {}) });
            storage.getState().applyTeammateRun(run);
            setNote('');
        });
    };
    const cancelRun = (run: TeammateRun) => {
        if (!credentials || busy || !isTeammateRunCancellable(run)) return;
        return withBusy(async () => {
            if (!await Modal.confirm(t('teammates.cancelRun'), t('teammates.cancelRunConfirm'), { confirmText: t('teammates.cancelRun'), destructive: true })) return;
            storage.getState().applyTeammateRun((await cancelTeammateRun(credentials, run.id)).run);
        });
    };
    const message = () => {
        if (!teammate || busy) return;
        return withBusy(async () => {
            const channel = await sync.channels.openDm(teammate);
            router.push(`/channels/${channel.id}`);
        }, () => t('channels.createError'));
    };
    const act = async (archive: boolean) => {
        if (!credentials || !teammate || busy) return;
        if (archive && !await Modal.confirm(t('teammates.archive'), t('teammates.archiveConfirm'), { confirmText: t('teammates.archive'), destructive: true })) return;
        await withBusy(async () => {
            const updated = archive ? await archiveTeammate(credentials, id) : await updateTeammate(credentials, id, { status: teammate.status === 'active' ? 'paused' : 'active' });
            storage.getState().applyTeammates([updated]);
        });
    };
    if (!teammate) return <TeammateLoadFallback loading={loading} error={error} refresh={refresh} />;
    const activeTasks = (tasks ?? []).filter(task => !['done', 'cancelled'].includes(task.status));
    const pastTasks = (tasks ?? []).filter(task => ['done', 'cancelled'].includes(task.status));
    const budget = spend ? spend.budgetUsd : teammate.monthlyBudgetUsd;
    const visibleRuns = runs?.filter(isVisibleTeammateRun);
    const budgetRatio = budget && spend ? spend.spentUsd / budget : 0;
    const isActive = teammate.status === 'active';
    const canAct = !!credentials && isActive;
    const editRuntime = teammate.status !== 'archived' ? () => router.push(`/teammates/${encodeURIComponent(id)}/edit?step=runtime`) : undefined;
    const liveTask = liveRun?.taskId ? tasks?.find(task => task.id === liveRun.taskId) : undefined;
    const openLive = liveRun ? (liveRun.sessionId ? () => navigateToSession(liveRun.sessionId!) : liveTask ? () => router.push(`/teammates/tasks/${encodeURIComponent(liveTask.id)}`) : undefined) : undefined;
    const stats = computeTeammateStats(runs, range, now);
    const machineOnline = !!machine && isMachineOnline(machine);
    const taskItem = (task: NonNullable<typeof tasks>[number]) => (
        <Item key={task.id} title={task.title} subtitle={[new Date(task.updatedAt).toLocaleString(), task.summary].filter(Boolean).join(' · ')} subtitleLines={2}
            detail={t(`teammates.taskStatus.${task.status}`)} showChevron onPress={() => router.push(`/teammates/tasks/${encodeURIComponent(task.id)}`)} />
    );
    const tile = (label: string, value: string, hint?: string) => (
        <View style={styles.tile}>
            <Text style={styles.tileLabel}>{label}</Text>
            <Text style={styles.tileValue}>{value}</Text>
            {hint && <Text style={styles.tileHint}>{hint}</Text>}
        </View>
    );
    const instructions = teammate.instructions;
    const longInstructions = instructions.split('\n').length > 5 || instructions.length > 280;

    return <ItemList stickyHeaderIndices={[1]} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
        <View>
            <View style={styles.hero}>
                <TeammateAvatar teammate={teammate} size={64} />
                <Text style={styles.name} numberOfLines={2}>{teammate.name}</Text>
                <Text style={styles.subline} numberOfLines={1}>@{teammate.handle}{teammate.role ? ` · ${teammate.role.split(/[：:]/)[0].trim()}` : ''}</Text>
                <View style={styles.status}>
                    <TeammateAvailability teammate={teammate} />
                    {!isActive && <Text style={styles.statusBadge}>{t(`teammates.status.${teammate.status}`)}</Text>}
                </View>
            </View>
            {teammate.status !== 'archived' && <View style={styles.actions}>
                <ActionButton primary icon="chatbubble-ellipses-outline" label={t('teammates.message')} disabled={busy || !credentials} onPress={message} />
                {teammate.status !== 'budget_paused' && <ActionButton icon={isActive ? 'pause-outline' : 'play-outline'} label={isActive ? t('teammates.pause') : t('teammates.resume')} disabled={busy} onPress={() => act(false)} />}
            </View>}
        </View>

        <View style={styles.sticky}>
            {liveRun && <Pressable accessibilityRole="button" disabled={!openLive} onPress={openLive} style={({ pressed }) => [styles.strip, pressed && styles.pressed]}>
                <View style={styles.stripDot} />
                <View style={styles.stripBody}>
                    <Text style={styles.stripLabel} numberOfLines={1}>{t(`teammates.runStatus.${liveRun.status}`)}</Text>
                    <Text style={styles.stripTitle} numberOfLines={1}>{liveTask?.title ?? t(`teammates.trigger.${liveRun.trigger}`)}</Text>
                </View>
                <Text style={styles.stripTime}>{formatElapsed(now - (liveRun.startedAt ?? liveRun.queuedAt))}</Text>
                {openLive && <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />}
            </Pressable>}
            <Segmented value={tab} onChange={setTab} options={[
                { value: 'profile', label: t('teammates.tabProfile') },
                { value: 'activity', label: t('teammates.tabActivity') },
                { value: 'stats', label: t('teammates.tabStats') },
            ]} />
        </View>

        <View>
            {(error || actionError) && <View style={styles.notice}>
                <Text accessibilityRole="alert" style={shared.error}>{actionError || error}</Text>
                {error && <Pressable accessibilityRole="button" onPress={refresh}><Text style={styles.link}>{t('common.retry')}</Text></Pressable>}
            </View>}

            {teammate.status === 'budget_paused' && <ItemGroup footer={t('teammates.budgetAutoResume')}>
                <Item title={t('teammates.budgetPausedBanner')} titleStyle={styles.warning} subtitleLines={0} detail={t('teammates.raiseBudget')} showChevron
                    onPress={() => router.push(`/teammates/${encodeURIComponent(id)}/edit`)} />
            </ItemGroup>}

            {tab === 'profile' && <>
                <ItemGroup title={t('teammates.runtime')}>
                    <RuntimeItem title={t('teammates.controllerRuntime')} provider={teammate.controllerProvider} model={teammate.controllerModel} permissionMode={teammate.controllerPermissionMode} profileId={teammate.controllerProfileId} onPress={editRuntime} />
                    <RuntimeItem title={t('teammates.workerRuntime')} provider={teammate.workerProvider} model={teammate.model} permissionMode={teammate.workerPermissionMode} profileId={teammate.workerProfileId} onPress={editRuntime} />
                    <Item title={t('teammates.machine')} detail={machine ? getMachineDisplayName(machine, machine.id, {}) : undefined}
                        rightElement={<View style={[styles.dot, { backgroundColor: machineOnline ? theme.colors.status.connected : theme.colors.textSecondary }]} />} />
                </ItemGroup>

                {(teammate.skills.length > 0 || teammate.repos.length > 0) && <ItemGroup title={`${t('teammates.skills')} · ${t('teammates.repos')}`}>
                    {teammate.skills.map(skill => {
                        const info = machineSkills.skills.find(item => item.name === skill);
                        const missing = machineSkills.status === 'ready' && !info;
                        return <Item key={skill} title={skill} subtitle={missing ? t('teammates.skillMissing') : info?.description || undefined} subtitleLines={2}
                            subtitleStyle={missing ? { color: theme.colors.textDestructive } : undefined} />;
                    })}
                    {teammate.repos.map(repo => <Item key={repo} title={repo} />)}
                </ItemGroup>}

                <ItemGroup title={t('teammates.instructions')}>
                    <View style={styles.block}>
                        <Text style={instructions ? shared.text : shared.muted} numberOfLines={expanded ? undefined : 5}>{instructions || t('teammates.wizard.noInstructions')}</Text>
                        {longInstructions && <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)}>
                            <Text style={styles.link}>{expanded ? t('teammates.ai.showLess') : t('teammates.ai.showMore')}</Text>
                        </Pressable>}
                    </View>
                </ItemGroup>

                <ItemGroup title={t('teammates.autonomy')}>
                    <Item title={t('teammates.selfAssign')} detail={teammate.canSelfAssign ? t('common.yes') : t('common.no')} />
                    <Item title={t('teammates.budget')} detail={teammate.monthlyBudgetUsd !== null ? `$${teammate.monthlyBudgetUsd.toFixed(2)}` : t('teammates.noBudget')} />
                    <Item title={t('teammates.activeHours')} detail={teammate.activeHours ? `${teammate.activeHours.start}–${teammate.activeHours.end}` : '—'} />
                    <Item title={t('teammates.heartbeat')} detail={teammate.heartbeatIntervalMin ? `${teammate.heartbeatIntervalMin}` : '—'} />
                </ItemGroup>

                {isActive && <ItemGroup title={t('teammates.manualRun')}>
                    <View style={styles.block}>
                        <TextInput style={styles.note} accessibilityLabel={t('teammates.runNote')}
                            placeholder={t('teammates.runNoteHint')} placeholderTextColor={theme.colors.textSecondary}
                            value={note} onChangeText={setNote} multiline maxLength={4000} editable={!busy} />
                    </View>
                    <Item title={t('teammates.runNow')} disabled={busy || !canAct} loading={busy} onPress={runNow} titleStyle={styles.link} />
                    <Item title={t('teammates.heartbeatNow')} disabled={heartbeatBusy || !canAct} loading={heartbeatBusy} onPress={heartbeatNow} />
                    <Item title={t('teammates.dreamingNow')} disabled={dreamingBusy || !canAct} loading={dreamingBusy} onPress={dreamingNow} />
                </ItemGroup>}

                {teammate.status !== 'archived' && <ItemGroup>
                    <Item title={t('teammates.archive')} destructive disabled={busy} onPress={() => act(true)} />
                </ItemGroup>}
            </>}

            {tab === 'activity' && <>
                {liveRun && <ItemGroup>
                    <Item title={liveTask?.title ?? t(`teammates.trigger.${liveRun.trigger}`)} subtitle={t(`teammates.runStatus.${liveRun.status}`)} leftElement={<ActivityIndicator size="small" />} />
                    {liveRun.sessionId && <Item title={t('teammates.openSession')} showChevron onPress={() => navigateToSession(liveRun.sessionId!)} />}
                    <Item title={t('teammates.cancelRun')} destructive disabled={busy} onPress={() => cancelRun(liveRun)} />
                </ItemGroup>}
                <ItemGroup title={t('teammates.activeTasks')}>
                    {activeTasks.length ? activeTasks.map(taskItem) : <Item title={t('teammates.noTasks')} titleStyle={shared.muted} />}
                </ItemGroup>
                {pastTasks.length > 0 && <ItemGroup title={t('teammates.pastTasks')}>{pastTasks.map(taskItem)}</ItemGroup>}
                <ItemGroup title={t('teammates.recentRuns')}>
                    {!visibleRuns?.length && <Item title={t('teammates.noRuns')} titleStyle={shared.muted} />}
                    {visibleRuns?.map(run => <Item key={run.id} title={t(`teammates.trigger.${run.trigger}`)}
                        subtitle={[new Date(run.queuedAt).toLocaleString(), run.costUsd !== null ? `$${run.costUsd.toFixed(2)}` : null, run.failureReason ? t(`teammates.failure.${run.failureReason}`) : null].filter(Boolean).join(' · ')}
                        subtitleLines={2} detail={t(`teammates.runStatus.${run.status}`)} showChevron={!!run.sessionId}
                        onPress={run.sessionId ? () => navigateToSession(run.sessionId!) : undefined} />)}
                </ItemGroup>
            </>}

            {tab === 'stats' && <>
                <View style={styles.rangeWrap}>
                    <Segmented value={range} onChange={setRange} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }]} />
                </View>
                <View style={styles.tiles}>
                    {tile(t('teammates.runCost'), `$${stats.costUsd.toFixed(2)}`, t('teammates.lastDays', { count: range }))}
                    {tile(t('teammates.runCount'), String(stats.runCount), stats.successRate !== null ? t('teammates.successRate', { rate: stats.successRate }) : undefined)}
                </View>
                <ItemGroup title={t('teammates.monthBudget')}>
                    <View style={styles.block}>
                        <Text style={shared.text}>{spend ? `$${spend.spentUsd.toFixed(2)}` : '—'} / {budget !== null ? `$${budget.toFixed(2)}` : t('teammates.noBudget')}</Text>
                        {budget !== null && spend && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: budget, now: spend.spentUsd }} style={styles.track}>
                            <View style={[styles.fill, { width: `${Math.min(100, budget > 0 ? spend.spentUsd / budget * 100 : 0)}%`, backgroundColor: budgetRatio >= TEAMMATE_BUDGET_WARNING_RATIO ? theme.colors.warningCritical : theme.colors.button.primary.background }]} />
                        </View>}
                    </View>
                </ItemGroup>
                <ItemGroup title={t('teammates.byRunType')}>
                    {!stats.byTrigger.length && <Item title={t('teammates.noRuns')} titleStyle={shared.muted} />}
                    {stats.byTrigger.map(group => <Item key={group.trigger} title={t(`teammates.trigger.${group.trigger}`)} detail={`${group.count} · $${group.costUsd.toFixed(2)}`} />)}
                </ItemGroup>
            </>}
        </View>
    </ItemList>;
});

const styles = StyleSheet.create((theme) => ({
    hero: { alignItems: 'center', gap: 4, paddingTop: 16, paddingBottom: 4, paddingHorizontal: 24 },
    name: { ...Typography.default('semiBold'), fontSize: 22, color: theme.colors.text, textAlign: 'center', marginTop: 6 },
    subline: { ...Typography.default(), fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
    status: { alignItems: 'center', gap: 4, marginTop: 2 },
    statusBadge: { ...Typography.default('semiBold'), fontSize: 13, color: theme.colors.warning },
    actions: { flexDirection: 'row', gap: 10, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    actionButton: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface },
    actionPrimary: { backgroundColor: theme.colors.button.primary.background },
    actionLabel: { ...Typography.default('semiBold'), fontSize: 15 },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.7 },
    sticky: { paddingHorizontal: 16, backgroundColor: theme.colors.groupped.background, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    strip: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', maxWidth: layout.maxWidth - 32, alignSelf: 'center', marginTop: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.surface },
    stripDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.status.connected },
    stripBody: { flex: 1, gap: 1 },
    stripLabel: { ...Typography.default(), fontSize: 12, color: theme.colors.textSecondary },
    stripTitle: { ...Typography.default('semiBold'), fontSize: 15, color: theme.colors.text },
    stripTime: { ...Typography.mono(), fontSize: 14, color: theme.colors.textSecondary },
    segmented: { flexDirection: 'row', width: '100%', maxWidth: layout.maxWidth - 32, alignSelf: 'center', marginTop: 8, padding: 2, borderRadius: 9, backgroundColor: theme.colors.divider },
    segment: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7 },
    segmentActive: { backgroundColor: theme.colors.surface },
    segmentText: { ...Typography.default(), fontSize: 14, color: theme.colors.textSecondary },
    segmentTextActive: { ...Typography.default('semiBold'), color: theme.colors.text },
    notice: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 6 },
    link: { ...Typography.default('semiBold'), fontSize: 15, color: theme.colors.textLink },
    warning: { color: theme.colors.warningCritical },
    block: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    track: { height: 6, borderRadius: 3, backgroundColor: theme.colors.divider, overflow: 'hidden' },
    fill: { height: 6 },
    note: { ...Typography.default(), fontSize: 15, minHeight: 64, color: theme.colors.text, textAlignVertical: 'top' },
    rangeWrap: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
    tiles: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
    tile: { flex: 1, gap: 2, padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface },
    tileLabel: { ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary },
    tileValue: { ...Typography.default('semiBold'), fontSize: 26, color: theme.colors.text },
    tileHint: { ...Typography.default(), fontSize: 12, color: theme.colors.textSecondary },
}));

import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useShallow } from 'zustand/react/shallow';
import { useRouter, useFocusEffect } from 'expo-router';
import { TEAMMATE_TASK_ACTIVE_STATUSES } from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useTeammateTask } from '@/hooks/useTeammateTask';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { getServerUrl } from '@/sync/serverConfig';
import { updateTeammateTask } from '@/sync/apiTeammateTasks';
import { openExternalUrl } from '@/utils/tauri';
import { t } from '@/text';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { TeammateRunRow } from './TeammateRunRow';
import { Action, styles, TeammateAvatar } from './ui';

export const TeammateTaskPanel = React.memo(({ id }: { id: string }) => {
    const detail = useTeammateTask(id);
    const teammate = storage(state => detail ? state.teammates[detail.task.teammateId] : undefined);
    const creator = storage(state => detail?.task.createdByTeammateId ? state.teammates[detail.task.createdByTeammateId] : undefined);
    const workers = React.useMemo(() => detail?.sessions.filter(session => session.role === 'worker') ?? [], [detail]);
    const workerTitles = storage(useShallow(state => workers.map(({ sessionId }) =>
        state.sessions[sessionId]?.metadata?.summary?.text || state.sessions[sessionId]?.metadata?.name)));
    const router = useRouter();
    const openSession = useNavigateToSession();
    const { credentials } = useAuth();
    const [now, setNow] = React.useState(Date.now);
    const liveRuns = detail?.runs.some(isTeammateRunCancellable) ?? false;
    useFocusEffect(React.useCallback(() => {
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), liveRuns ? 1000 : 60000);
        return () => clearInterval(timer);
    }, [liveRuns]));
    const actionLock = React.useRef(false);
    const change = async (action: 'stop' | 'resume' | 'cancel') => {
        if (!credentials || actionLock.current) return;
        actionLock.current = true;
        const server = getServerUrl();
        try {
            if (action === 'cancel' && !await Modal.confirm(t('teammateTasks.cancel'), t('teammateTasks.cancelConfirm'), {
                confirmText: t('teammateTasks.cancel'), destructive: true,
            })) return;
            if (!sync.tasks.isCurrent(credentials, server)) return;
            const task = await updateTeammateTask(credentials, id, action);
            if (!sync.tasks.isCurrent(credentials, server)) return;
            storage.getState().applyTeammateTask(task);
            sync.tasks.invalidate(id);
        } catch { Modal.alert(t('teammateTasks.title'), t('teammateTasks.error')); }
        finally { actionLock.current = false; }
    };
    const [stopping, stop] = useHappyAction(() => change('stop'));
    const [resuming, resume] = useHappyAction(() => change('resume'));
    const [cancelling, cancel] = useHappyAction(() => change('cancel'));
    const busy = stopping || resuming || cancelling;
    const [linkBusy, openPr] = useHappyAction(async () => {
        if (!detail?.task.prUrl) return;
        try { await openExternalUrl(detail.task.prUrl); }
        catch { Modal.alert(t('teammateTasks.title'), t('channels.linkError')); }
    });
    if (!detail) return <View style={styles.card}><ActivityIndicator /></View>;
    const { task } = detail;
    const active = (TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status);
    return <View style={styles.card}>
        <Text style={styles.heading}>{task.title}</Text>
        <View style={styles.row}><Text style={[styles.chip, styles.text]}>{t(`teammates.taskStatus.${task.status}`)}</Text>
            {teammate && <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/teammates/${encodeURIComponent(teammate.id)}`)} style={styles.row}>
                <TeammateAvatar teammate={teammate} /><Text style={styles.text}>{teammate.name}</Text>
            </TouchableOpacity>}
        </View>
        {task.createdByTeammateId && <Text style={styles.muted}>{t('teammateTasks.createdByAgent', { agent: creator ? creator.name : t('channels.unknownAgent') })}</Text>}
        {task.summary && <Text style={styles.text}>{task.summary}</Text>}
        {task.prUrl && <Action title={t('teammateTasks.pr')} disabled={linkBusy} onPress={openPr} />}
        <View style={styles.row}>
            {active && <Action title={t('teammateTasks.stop')} disabled={busy || !credentials} onPress={stop} />}
            {task.status === 'paused' && <Action title={t('teammates.resume')} disabled={busy || !credentials} onPress={resume} />}
            {(active || task.status === 'paused') && <Action title={t('teammateTasks.cancel')} disabled={busy || !credentials} onPress={cancel} />}
        </View>
        <Text style={styles.heading}>{t('teammateTasks.log')}</Text>
        {!detail.runs.length && <Text style={styles.muted}>{t('teammates.noRuns')}</Text>}
        {[...detail.runs].sort((a, b) => b.queuedAt - a.queuedAt).map(run => <TeammateRunRow key={run.id} run={run} now={now} busy={busy}
            onOpen={openSession} openLabel={t('teammateTasks.thinking')} relativeTime showCancel={false} onCancel={() => {}} />)}
        <Text style={styles.heading}>{t('teammateTasks.execution')}</Text>
        {workers.map((session, index) => <Action key={session.sessionId}
            title={workerTitles[index] || `${t('teammateTasks.execution')} ${index + 1}`}
            onPress={() => openSession(session.sessionId)} />)}
    </View>;
});

/** Kept in the route layout so the issue link never changes header configuration in the page. */
export function TeammateTaskIssueLink({ id }: { id: string }) {
    const task = storage(state => state.teammateTaskDetails[id]?.task);
    const router = useRouter();
    const { theme } = useUnistyles();
    const resource = task?.source === 'github-issue' ? task.resourceId?.match(/^([^/]+)\/([^#]+)#([1-9]\d*)$/) : null;
    if (!resource) return null;
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('teammateTasks.issue')} style={{ padding: 8 }}
        onPress={() => router.push(`/repos/${encodeURIComponent(resource[1])}/${encodeURIComponent(resource[2])}/issue/${resource[3]}`)}>
        <Text style={{ color: theme.colors.header.tint }}>{t('teammateTasks.issue')}</Text>
    </TouchableOpacity>;
}

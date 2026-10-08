import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { fetchAiDecisions, fetchAiExecutionEvents, respondAiDecision, type AiDecisionRequest, type AiPersistentExecutionEvent } from '@/sync/apiAiTeams';
import { withAiMutationIdentity } from '@/sync/aiMutationJournal';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 64, gap: 18 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    row: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 7 },
    eventSection: { paddingTop: 8, gap: 8 },
    eventRow: { gap: 4 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

type DecisionStatus = 'pending' | 'decided' | 'expired';

function decisionIdentity(item: AiDecisionRequest, isZh: boolean): string {
    if (!item.operationId || !item.actionType || !item.actionHash) {
        return isZh ? '旧版任务级请求（无逐操作身份）' : 'Legacy task request (no operation identity)';
    }
    return `${item.actionType} · ${item.operationId}\nSHA-256: ${item.actionHash.slice(0, 32)}\n${item.actionHash.slice(32)}`;
}

function canRespondToDecision(item: AiDecisionRequest, now = Date.now()): boolean {
    return item.status === 'pending' && Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) > now;
}

function deliveryLabel(status: string, isZh: boolean, decision: AiDecisionRequest['decision']): string {
    switch (status) {
        case 'pending': return isZh ? '决定已记录，等待送达原执行' : 'Decision saved; awaiting delivery to the execution';
        case 'delivered': return decision === 'rejected'
            ? (isZh ? '拒绝已送达原执行，操作未获授权' : 'Rejection delivered to the execution; operation not authorized')
            : (isZh ? '已送达原执行，动作结果待核对' : 'Delivered to the execution; verify the action result');
        case 'blocked': return isZh ? '投递受阻，动作未获确认' : 'Delivery blocked; action unconfirmed';
        default: return status;
    }
}

export default function AiDecisionsPage() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const isZh = getCurrentLanguage().startsWith('zh');
    const { credentials } = useAuth();
    const teamData = useManagedAiTeamData();
    const [status, setStatus] = React.useState<DecisionStatus>('pending');
    const [items, setItems] = React.useState<AiDecisionRequest[]>([]);
    const [cursor, setCursor] = React.useState<string | null>(null);
    const [hasMore, setHasMore] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [eventDecisionId, setEventDecisionId] = React.useState<string | null>(null);
    const [events, setEvents] = React.useState<AiPersistentExecutionEvent[]>([]);
    const [eventCursor, setEventCursor] = React.useState(0);
    const [hasMoreEvents, setHasMoreEvents] = React.useState(false);

    const load = React.useCallback(async (append = false) => {
        if (!credentials) return;
        setBusy(true); setError(null);
        try {
            const result = await fetchAiDecisions(credentials, status, append ? cursor ?? undefined : undefined);
            setItems((current) => append ? [...current, ...result.items] : result.items);
            setCursor(result.nextCursor);
            setHasMore(result.items.length === 50 && !!result.nextCursor);
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    }, [credentials?.secret, status, cursor]);

    React.useEffect(() => {
        let active = true;
        setItems([]); setCursor(null); setHasMore(false); setError(null);
        setEventDecisionId(null); setEvents([]); setEventCursor(0); setHasMoreEvents(false);
        if (credentials) fetchAiDecisions(credentials, status).then((result) => {
            if (!active) return;
            setItems(result.items); setCursor(result.nextCursor);
            setHasMore(result.items.length === 50 && !!result.nextCursor);
        }).catch((cause) => {
            if (active) setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { active = false; };
    }, [credentials?.secret, status]);


    const decide = async (item: AiDecisionRequest, decision: 'approved' | 'rejected') => {
        if (!credentials || busy) return;
        if (!canRespondToDecision(item)) {
            setError(isZh ? '请求已到期或状态已变化，请刷新后重审。' : 'This request expired or changed. Refresh before reviewing.');
            return;
        }
        let note = '';
        const reviewText = `${item.payload.summary ?? item.kind}\n\n${decisionIdentity(item, isZh)}\n\nExecution: ${item.executionId}\nv${item.version} · ${new Date(item.expiresAt).toLocaleString()}`;
        if (decision === 'approved') {
            if (!await Modal.confirm(isZh ? '批准这项请求？' : 'Approve this request?', reviewText)) return;
        } else {
            const answer = await Modal.prompt(isZh ? '拒绝请求' : 'Reject request', reviewText,
                { placeholder: isZh ? '原因' : 'Reason', confirmText: isZh ? '拒绝' : 'Reject' });
            if (answer === null) return;
            note = answer.trim();
        }
        setBusy(true); setError(null);
        try {
            await withAiMutationIdentity(credentials, `decision:${item.id}:${item.version}:${decision}`,
                { decisionId: item.id, version: item.version, decision, note },
                (clientRequestId) => respondAiDecision(credentials, item.id, { version: item.version, clientRequestId, decision, note }));
            const result = await fetchAiDecisions(credentials, status);
            setItems(result.items); setCursor(result.nextCursor);
            setHasMore(result.items.length === 50 && !!result.nextCursor);
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    const loadEvents = async (item: AiDecisionRequest, append = false) => {
        if (!credentials || busy) return;
        setBusy(true); setError(null);
        try {
            const result = await fetchAiExecutionEvents(credentials, item.executionId, append ? eventCursor : 0);
            setEventDecisionId(item.id);
            setEvents((current) => append ? [...current, ...result.items] : result.items);
            setEventCursor(result.nextAfterSeq);
            setHasMoreEvents(result.items.length === 50);
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };


    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '待决策' : 'Decisions' }} />
        <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.actions}>{(['pending', 'decided', 'expired'] as const).map((value) => <Pressable key={value} style={[styles.action, status === value && styles.selected]} onPress={() => setStatus(value)}>
                <Text style={styles.actionText}>{value === 'pending' ? (isZh ? '待处理' : 'Pending') : value === 'decided' ? (isZh ? '已决定' : 'Decided') : (isZh ? '已过期' : 'Expired')}</Text>
            </Pressable>)}</View>
            <View style={styles.actions}><Text style={styles.heading}>{isZh ? '决策请求' : 'Decision requests'} · {items.length}</Text>
                <Pressable accessibilityLabel={isZh ? '刷新决策' : 'Refresh decisions'} disabled={busy} onPress={() => load()}><Ionicons name="refresh-outline" size={18} color={theme.colors.text} /></Pressable>
            </View>
            {items.map((item) => {
                const work = teamData.workItems.find((entry) => entry.id === item.workItemId);
                const executionId = work?.executionIds[0];
                const relatedExecution = teamData.executions.find((entry) => entry.orchestratorExecutionId === item.executionId);
                const safetyErrorCode = relatedExecution?.errorCode === 'APPROVAL_SESSION_INTERRUPTED'
                    || relatedExecution?.errorCode === 'APPROVAL_OUTCOME_UNCERTAIN'
                    ? relatedExecution.errorCode : item.errorCode;
                return <View key={item.id} style={styles.row}>
                    <Text style={styles.text}>{work?.title ?? item.payload.summary ?? item.kind}</Text>
                    {work && item.payload.summary ? <Text style={styles.muted}>{item.payload.summary}</Text> : null}
                    <Text style={styles.muted}>{item.kind} · {item.status} · v{item.version} · {new Date(item.expiresAt).toLocaleString()}</Text>
                    <Text style={styles.muted} selectable>Execution: {item.executionId}</Text>
                    <Text style={styles.muted} selectable>{decisionIdentity(item, isZh)}</Text>
                    {item.status === 'decided' ? <Text style={styles.muted}>{item.decision} · {deliveryLabel(item.deliveryStatus, isZh, item.decision)}</Text> : null}
                    {safetyErrorCode ? <Text style={styles.muted} selectable>{safetyErrorCode}</Text> : null}
                    <View style={styles.actions}>
                        {executionId ? <Pressable style={styles.action} onPress={() => router.push(`/inbox/ai/executions/${executionId}` as never)}><Ionicons name="open-outline" size={16} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '执行详情' : 'Execution'}</Text></Pressable> : null}
                        <Pressable style={styles.action} disabled={busy} onPress={() => loadEvents(item)}><Ionicons name="list-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '审计事件' : 'Audit events'}</Text></Pressable>
                        {canRespondToDecision(item) ? <>
                            <Pressable style={styles.action} disabled={busy} onPress={() => decide(item, 'approved')}><Ionicons name="checkmark-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '批准' : 'Approve'}</Text></Pressable>
                            <Pressable style={styles.action} disabled={busy} onPress={() => decide(item, 'rejected')}><Ionicons name="close-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '拒绝' : 'Reject'}</Text></Pressable>
                        </> : item.status === 'pending' ? <Text style={styles.error}>{isZh ? '已到期，请刷新' : 'Expired; refresh'}</Text> : null}
                        {safetyErrorCode === 'APPROVAL_SESSION_INTERRUPTED' || safetyErrorCode === 'APPROVAL_OUTCOME_UNCERTAIN'
                            ? <Text style={styles.error}>{safetyErrorCode === 'APPROVAL_OUTCOME_UNCERTAIN'
                                ? (isZh ? '动作结果不确定；人工核查外部副作用。原请求不得重投。' : 'Action outcome uncertain. Inspect external effects; do not redeliver.')
                                : (isZh ? '审批会话中断；人工核查外部副作用。原请求不得重投。' : 'Approval session interrupted. Inspect external effects; do not redeliver.')}</Text>
                            : item.deliveryStatus === 'blocked' ? <Text style={styles.error}>{isZh
                                ? '投递受阻；请核查原执行状态。' : 'Delivery blocked; inspect the original execution.'}</Text> : null}
                    </View>
                    {eventDecisionId === item.id ? <View style={styles.eventSection}>
                        <Text style={styles.muted}>{isZh ? '审计事件' : 'Audit events'} · {events.length}</Text>
                        {events.map((event) => <View key={event.eventId} style={styles.eventRow}>
                            <Text style={styles.muted}>{event.seq} · {event.kind} · {event.phase} · {new Date(event.occurredAt).toLocaleString()}</Text>
                            <Text style={styles.text}>{event.redactedSummary}</Text>
                        </View>)}
                        {!events.length ? <Text style={styles.muted}>{isZh ? '暂无事件' : 'No events yet'}</Text> : null}
                        {hasMoreEvents ? <Pressable style={styles.action} disabled={busy} onPress={() => loadEvents(item, true)}><Ionicons name="chevron-down" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '更多事件' : 'More events'}</Text></Pressable> : null}
                    </View> : null}
                </View>;
            })}
            {!items.length && !error ? <Text style={styles.muted}>{isZh ? '暂无请求' : 'No requests'}</Text> : null}
            {hasMore ? <Pressable style={styles.action} disabled={busy} onPress={() => load(true)}><Ionicons name="chevron-down" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '更多' : 'More'}</Text></Pressable> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

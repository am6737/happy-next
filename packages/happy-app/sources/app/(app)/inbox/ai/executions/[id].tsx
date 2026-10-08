import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AiIdentityAvatar } from '@/features/aiTeams/components';
import { findAiAgent, findAiExecution, findAiWorkItem, getAiWorkSourcePath, type AiExecutionEvent, type AiExecutionStatus } from '@/features/aiTeams/types';
import { commandManagedAiWorkItem, fetchManagedAiCollaboration, fetchManagedAiIntegrationVerification, setManagedAiWorkAcceptance, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import type { AiCollaboration, AiIntegrationVerification } from '@/sync/apiAiTeams';
import { getCurrentLanguage } from '@/text';
import { canRetryAiExecution } from '@/features/aiTeams/executionSafety';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal } from '@/modal';
import { useAuth } from '@/auth/AuthContext';
import { AiTeamRequestError, fetchAiExecutionEvents, type AiPersistentExecutionEvent } from '@/sync/apiAiTeams';

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 22 },
    runCard: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 14,
        paddingVertical: 13,
    },
    runTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    runBody: { flex: 1, minWidth: 0, gap: 4 },
    runHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    runIdentity: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    runAgent: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    aiText: { ...Typography.default('semiBold'), color: theme.colors.textLink, fontSize: 9, letterSpacing: 0.3 },
    runStatus: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto', flexShrink: 0 },
    runSummary: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, minWidth: 0 },
    statusDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
    workLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    workLinkText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flex: 1 },
    contextLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    contextLabel: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12 },
    contextValue: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 12, flex: 1 },
    bottomBar: { backgroundColor: theme.colors.surface, paddingTop: 10, paddingHorizontal: 16 },
    bottomBarInner: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' },
    sessionButton: { minHeight: 44, borderRadius: 11, backgroundColor: theme.colors.button.primary.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 16 },
    sessionButtonText: { ...Typography.default('semiBold'), color: theme.colors.button.primary.tint, fontSize: 14 },
    activitySection: { gap: 5 },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 },
    groupLabel: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    groupCount: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto' },
    eventList: { gap: 4 },
    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingLeft: 28 },
    eventIcon: { width: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    eventText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, flex: 1, minWidth: 0 },
    eventActor: { ...Typography.default('semiBold'), color: theme.colors.textSecondary, fontSize: 13 },
    eventTime: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flexShrink: 0 },
    acceptance: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider, paddingTop: 16, gap: 10 },
    acceptanceTitle: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    acceptanceActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
    acceptanceSecondary: { minHeight: 38, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' },
    acceptancePrimary: { minHeight: 38, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.button.primary.background, alignItems: 'center', justifyContent: 'center' },
    acceptanceSecondaryText: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13 },
    acceptancePrimaryText: { ...Typography.default('semiBold'), color: theme.colors.button.primary.tint, fontSize: 13 },
    taskSection: { gap: 7 },
    taskHeader: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    taskRow: { paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 4 },
    taskTitle: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13 },
    taskMeta: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    taskResult: { ...Typography.default(), color: theme.colors.text, fontSize: 12, lineHeight: 18 },
}));

function statusColor(status: AiExecutionStatus): string {
    switch (status) {
        case 'completed': return '#34C759';
        case 'failed': return '#FF3B30';
        case 'cancelled': return '#8E8E93';
        case 'waiting_human': return '#FF9500';
        case 'reviewing': return '#AF52DE';
        case 'queued': return '#8E8E93';
        case 'dispatched': return '#5AC8FA';
        case 'running': return '#0A84FF';
    }
}

function eventIcon(event: AiExecutionEvent): React.ComponentProps<typeof Ionicons>['name'] {
    if (event.kind === 'tool') return 'terminal-outline';
    if (event.kind === 'result') return event.status === 'failed' ? 'close-circle-outline' : 'checkmark-circle-outline';
    if (event.kind === 'comment') return 'chatbubble-outline';
    if (event.status === 'waiting_human') return 'help-circle-outline';
    if (event.status === 'running' || event.status === 'reviewing') return 'play-circle-outline';
    if (event.status === 'queued') return 'time-outline';
    if (event.status === 'dispatched') return 'arrow-forward-circle-outline';
    return 'ellipse-outline';
}

function collaborationRoleLabel(role: string | null, isZh: boolean): string {
    if (role === 'leader_plan') return isZh ? '负责人规划' : 'Leader plan';
    if (role === 'delegated') return isZh ? '成员任务' : 'Member task';
    if (role === 'aggregate') return isZh ? '集成审查' : 'Integration review';
    return role ?? '';
}

function collaborationStatusLabel(status: string, isZh: boolean): string {
    const zh: Record<string, string> = { queued: '排队中', dispatching: '派发中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', dependency_failed: '依赖失败' };
    const en: Record<string, string> = { queued: 'Queued', dispatching: 'Dispatching', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', dependency_failed: 'Dependency failed' };
    return (isZh ? zh : en)[status] ?? status;
}

export default function AiExecutionDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const insets = useSafeAreaInsets();
    const isZh = getCurrentLanguage().startsWith('zh');
    const data = useManagedAiTeamData();
    const execution = findAiExecution(data, id);
    const { credentials } = useAuth();
    const auditExecutionId = execution?.orchestratorExecutionId ?? null;
    const navigateToSession = useNavigateToSession();
    const [expanded, setExpanded] = React.useState(true);
    const [reviewing, setReviewing] = React.useState(false);
    const [collaboration, setCollaboration] = React.useState<AiCollaboration | null>(null);
    const [verification, setVerification] = React.useState<AiIntegrationVerification | null>(null);
    const [collaborationError, setCollaborationError] = React.useState<string | null>(null);
    const [auditEvents, setAuditEvents] = React.useState<AiPersistentExecutionEvent[]>([]);
    const [auditCursor, setAuditCursor] = React.useState(0);
    const [auditMore, setAuditMore] = React.useState(false);
    const [auditError, setAuditError] = React.useState<string | null>(null);
    const [auditBusy, setAuditBusy] = React.useState(false);

    const loadAudit = React.useCallback(async (afterSeq = 0) => {
        if (!credentials || !auditExecutionId) return;
        setAuditBusy(true); setAuditError(null);
        try {
            const result = await fetchAiExecutionEvents(credentials, auditExecutionId, afterSeq);
            setAuditEvents((current) => afterSeq ? [...current, ...result.items] : result.items);
            setAuditCursor(result.nextAfterSeq);
            setAuditMore(result.items.length === 50);
        } catch (error) {
            setAuditError(error instanceof Error ? error.message : String(error));
        } finally { setAuditBusy(false); }
    }, [credentials?.secret, auditExecutionId]);

    React.useEffect(() => {
        setAuditEvents([]); setAuditCursor(0); setAuditMore(false); setAuditError(null);
        if (auditExecutionId) void loadAudit();
    }, [auditExecutionId, loadAudit]);

    React.useEffect(() => {
        if (!execution?.workItemId) return;
        let active = true;
        setCollaboration(null);
        setCollaborationError(null);
        fetchManagedAiCollaboration(execution.workItemId).then((result) => {
            if (active) setCollaboration(result);
        }).catch((error) => {
            if (active) setCollaborationError(error instanceof Error ? error.message : String(error));
        });
        fetchManagedAiIntegrationVerification(execution.workItemId).then((result) => {
            if (active) setVerification(result);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [execution?.workItemId]);

    const agent = execution ? findAiAgent(data, execution.agentId) : undefined;

    if (!execution) {
        return <View style={styles.container}><Stack.Screen options={{ headerTitle: isZh ? '执行详情' : 'Run details' }} /><Text style={{ color: theme.colors.text, padding: 24 }}>{isZh ? '未找到执行记录' : 'Run not found'}</Text></View>;
    }

    const work = findAiWorkItem(data, execution.workItemId);
    const executionErrorCode = execution.errorCode;
    const approvalSafetyFailure = executionErrorCode === 'APPROVAL_SESSION_INTERRUPTED'
        || executionErrorCode === 'APPROVAL_OUTCOME_UNCERTAIN';
    const upgradeRequired = executionErrorCode === 'UPGRADE_REQUIRED';
    const conversation = execution.conversationId ? data.conversations.find((item) => item.id === execution.conversationId) : undefined;
    const color = statusColor(execution.status);
    const canReview = execution.status === 'completed'
        && (work?.acceptanceStatus === 'pending' || work?.acceptanceStatus === 'changes_requested')
        && !!auditExecutionId;
    const canCancel = !!work && ['queued', 'dispatched', 'running', 'reviewing', 'waiting_human'].includes(execution.status);
    const canRetry = canRetryAiExecution(execution.status, executionErrorCode, !!work);
    const runCommand = async (command: 'cancel' | 'retry') => {
        if (!work || reviewing) return;
        if (command === 'cancel' && !await Modal.confirm(isZh ? '取消此任务？' : 'Cancel this task?', work.title)) return;
        setReviewing(true);
        try { await commandManagedAiWorkItem(work.id, command); }
        catch (error) { Modal.alert(isZh ? '操作失败' : 'Action failed', error instanceof Error ? error.message : undefined); }
        finally { setReviewing(false); }
    };
    const approve = async () => {
        if (!work || !auditExecutionId || reviewing) return;
        const reviewedExecutionId = auditExecutionId;
        if (!await Modal.confirm(isZh ? '通过本次结果？' : 'Approve this result?',
            `${work.title}\n${execution.summary}`)) return;
        setReviewing(true);
        try {
            await setManagedAiWorkAcceptance(work.id, 'approved',
                isZh ? '这版可以，通过验收。' : 'Approved.', reviewedExecutionId);
        } catch (error) {
            Modal.alert(isZh ? '无法提交验收' : 'Could not submit review',
                error instanceof AiTeamRequestError && error.status === 409
                    ? (isZh ? '结果已更新。请刷新执行详情，重新审阅最新结果后再批准。'
                        : 'The result changed. Refresh this execution and review the latest result before approving.')
                    : error instanceof Error ? error.message : undefined);
        } finally {
            setReviewing(false);
        }
    };
    const requestChanges = async () => {
        if (!work || reviewing) return;
        const note = await Modal.prompt(
            isZh ? '需要调整' : 'Request changes',
            isZh ? '说明需要修改的内容。提交后会创建一次新的真实执行。' : 'Describe what should change. A new execution will be created.',
            { placeholder: isZh ? '需要修改的内容' : 'Required changes', confirmText: isZh ? '提交' : 'Submit' },
        );
        if (note === null) return;
        setReviewing(true);
        try {
            await setManagedAiWorkAcceptance(work.id, 'changes_requested', note.trim() || undefined);
        } catch (error) {
            Modal.alert(isZh ? '无法创建修订任务' : 'Could not create revision', error instanceof Error ? error.message : undefined);
        } finally {
            setReviewing(false);
        }
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: isZh ? `第${execution.attempt}次执行` : `Run ${execution.attempt}` }} />
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.runCard}>
                    <View style={styles.runTopRow}>
                        {agent ? <AiIdentityAvatar id={agent.id} name={agent.name} size={30} /> : null}
                        <View style={styles.runBody}>
                            <View style={styles.runHeader}>
                                <View style={styles.runIdentity}>
                                    <Text style={styles.runAgent}>{agent?.name ?? '-'}</Text>
                                    <Text style={styles.aiText}>AI</Text>
                                </View>
                                <Text style={styles.runStatus}>{execution.statusLabel}</Text>
                                <View style={[styles.statusDot, { backgroundColor: color }]} />
                            </View>
                            <Text style={styles.runSummary} numberOfLines={1}>{execution.summary}</Text>
                        </View>
                    </View>
                    {work ? (
                        <Pressable style={styles.workLink} onPress={() => { const path = getAiWorkSourcePath(work); if (path) router.push(path as never); }}>
                            <Ionicons name="link-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.workLinkText} numberOfLines={1}>{work.sourceLabel} · {work.title}</Text>
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    ) : null}
                    {conversation ? (
                        <Pressable style={styles.contextLink} onPress={() => router.push(`/inbox/ai/${conversation.id}` as never)}>
                            <Ionicons name="chatbubble-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.contextLabel}>{isZh ? '相关聊天' : 'Related chat'}</Text>
                            <Text style={styles.contextValue} numberOfLines={1}>{conversation.title}</Text>
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    ) : null}
                </View>

                <View style={styles.activitySection}>
                    <Pressable style={styles.groupHeader} onPress={() => setExpanded((value) => !value)}>
                        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={theme.colors.textSecondary} />
                        <Text style={styles.groupLabel}>{isZh ? '执行记录' : 'Execution log'}</Text>
                        <Text style={styles.groupCount}>
                            {isZh ? `${execution.events.length} 条记录` : `${execution.events.length} entries`}
                        </Text>
                    </Pressable>
                    {expanded && (
                        <View style={styles.eventList}>
                            {execution.events.map((event) => {
                                const eventAgent = event.agentId ? findAiAgent(data, event.agentId) : undefined;
                                const eventColor = event.status ? statusColor(event.status) : theme.colors.textSecondary;
                                const actorName = event.actor === 'agent' ? eventAgent?.name : event.actor === 'human' ? (isZh ? '你' : 'You') : null;
                                return (
                                    <View key={event.id} style={styles.eventRow}>
                                        <View style={styles.eventIcon}>
                                            <Ionicons name={eventIcon(event)} size={17} color={eventColor} />
                                        </View>
                                        <Text style={styles.eventText} numberOfLines={1}>
                                            {actorName ? <Text style={styles.eventActor}>{actorName}{event.actor === 'agent' ? ' AI' : ''} </Text> : null}
                                            <Text style={styles.eventText}>{event.kind === 'comment' && event.body ? event.body : event.title}</Text>
                                        </Text>
                                        <Text style={styles.eventTime}>{event.timeLabel}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                {auditExecutionId ? <View style={styles.taskSection}>
                    <View style={styles.groupHeader}>
                        <Text style={styles.taskHeader}>{isZh ? '持久审计事件' : 'Audit events'} · {auditEvents.length}</Text>
                        <Pressable disabled={auditBusy} onPress={() => loadAudit()} accessibilityLabel={isZh ? '刷新审计事件' : 'Refresh audit events'}>
                            <Ionicons name="refresh-outline" size={17} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    {auditEvents.map((event) => <View key={event.eventId} style={styles.taskRow}>
                        <Text style={styles.taskMeta}>{event.seq} · {event.kind} · {event.phase} · {new Date(event.occurredAt).toLocaleString()}</Text>
                        <Text style={styles.taskResult}>{event.redactedSummary}</Text>
                    </View>)}
                    {auditMore ? <Pressable disabled={auditBusy} style={styles.groupHeader} onPress={() => loadAudit(auditCursor)}>
                        <Ionicons name="chevron-down-outline" size={17} color={theme.colors.textSecondary} />
                        <Text style={styles.taskMeta}>{isZh ? '更多事件' : 'More events'}</Text>
                    </Pressable> : null}
                    {auditError ? <Text style={styles.taskMeta}>{auditError}</Text> : null}
                </View> : null}

                {collaboration ? <View style={styles.taskSection}>
                    <Text style={styles.taskHeader}>{isZh ? '协作任务' : 'Collaboration tasks'} · {collaboration.tasks.length}</Text>
                    {verification && verification.status !== 'unavailable' ? <Text style={styles.taskMeta}>{isZh ? 'Git 集成验证' : 'Git integration verification'}: {verification.status === 'verified' ? (isZh ? '已验证' : 'Verified') : verification.status}{verification.errorCode ? ` · ${verification.errorCode}` : ''}</Text> : null}
                    {collaboration.tasks.map((task) => {
                        const owner = task.assignedAgentId ? findAiAgent(data, task.assignedAgentId) : undefined;
                        const parent = task.parentTaskId ? collaboration.tasks.find((item) => item.id === task.parentTaskId) : undefined;
                        return <View key={task.id} style={styles.taskRow}>
                            <Text style={styles.taskTitle}>{task.title ?? task.taskKey ?? task.id}</Text>
                            <Text style={styles.taskMeta}>{owner?.name ?? (isZh ? '未分配' : 'Unassigned')} · {collaborationStatusLabel(task.status, isZh)}{task.collaborationRole ? ` · ${collaborationRoleLabel(task.collaborationRole, isZh)}` : ''}</Text>
                            {parent ? <Text style={styles.taskMeta}>{isZh ? '上级任务' : 'Parent'}: {parent.title ?? parent.taskKey ?? parent.id}</Text> : null}
                            {task.dependsOnTaskKeys.length ? <Text style={styles.taskMeta}>{isZh ? '依赖' : 'Depends on'}: {task.dependsOnTaskKeys.join(', ')}</Text> : null}
                            {task.branchName ? <Text style={styles.taskMeta}>{isZh ? '分支' : 'Branch'}: {task.branchName}</Text> : null}
                            {task.commitSha ? <Text style={styles.taskMeta}>{isZh ? '提交' : 'Commit'}: {task.commitSha.slice(0, 12)}</Text> : null}
                            {task.finalResponse ? <Text style={styles.taskResult}>{task.finalResponse}</Text> : null}
                            {task.status === 'failed' || task.status === 'dependency_failed' ? <Text style={styles.taskMeta}>{isZh ? '该任务受阻，请查看执行记录。' : 'This task is blocked. Check the execution log.'}</Text> : null}
                        </View>;
                    })}
                    {collaboration.audits.map((audit, index) => <Text key={`${audit.taskId}-${index}`} style={styles.taskMeta}>
                        {isZh ? '改派' : 'Reassigned'}: {findAiAgent(data, audit.fromAgentId ?? '')?.name ?? '-'} → {findAiAgent(data, audit.toAgentId ?? '')?.name ?? '-'} · {audit.reason}
                    </Text>)}
                </View> : null}
                {collaborationError ? <Text style={styles.taskMeta}>{isZh ? '无法加载协作任务：' : 'Could not load collaboration tasks: '}{collaborationError}</Text> : null}

                {canReview ? (
                    <View style={styles.acceptance}>
                        <Text style={styles.acceptanceTitle}>{isZh ? '真人验收' : 'Human review'}</Text>
                        <View style={styles.acceptanceActions}>
                            <Pressable style={styles.acceptanceSecondary} disabled={reviewing} onPress={requestChanges}><Text style={styles.acceptanceSecondaryText}>{isZh ? '需要调整' : 'Request changes'}</Text></Pressable>
                            <Pressable style={styles.acceptancePrimary} disabled={reviewing} onPress={approve}><Text style={styles.acceptancePrimaryText}>{reviewing ? (isZh ? '提交中…' : 'Submitting…') : (isZh ? '通过' : 'Approve')}</Text></Pressable>
                        </View>
                    </View>
                ) : null}

                {execution.status === 'failed' ? <View style={styles.acceptance}>
                    <Text style={styles.taskMeta}>{upgradeRequired
                        ? (isZh ? '当前运行端版本不支持此 AI 任务。请升级运行端后创建新任务；原执行不会自动重试。'
                            : 'This runtime does not support this AI task. Upgrade it before creating a new task; this execution will not retry automatically.')
                        : approvalSafetyFailure
                        ? executionErrorCode === 'APPROVAL_OUTCOME_UNCERTAIN'
                            ? (isZh ? '动作结果不确定。请人工核查外部副作用；原执行和决定不得重试。' : 'Action outcome uncertain. Inspect external effects manually; do not retry this execution or decision.')
                            : (isZh ? '审批会话中断。请人工核查外部副作用；原执行和决定不得重试。' : 'Approval session interrupted. Inspect external effects manually; do not retry this execution or decision.')
                        : !executionErrorCode
                            ? (isZh ? '无法确认失败类型，重试暂不可用。' : 'Failure type unavailable; retry is disabled.')
                            : (isZh ? '执行失败，请查看审计后决定是否重试。' : 'Execution failed. Review the audit before retrying.')}</Text>
                    {executionErrorCode ? <Text style={styles.taskMeta} selectable>{executionErrorCode}</Text> : null}
                </View> : null}
                {canCancel || canRetry ? <View style={styles.acceptance}>
                    <View style={styles.acceptanceActions}>
                        {canCancel ? <Pressable style={styles.acceptanceSecondary} disabled={reviewing} onPress={() => runCommand('cancel')}><Text style={styles.acceptanceSecondaryText}>{isZh ? '取消任务' : 'Cancel task'}</Text></Pressable> : null}
                        {canRetry ? <Pressable style={styles.acceptanceSecondary} disabled={reviewing} onPress={() => runCommand('retry')}><Text style={styles.acceptanceSecondaryText}>{isZh ? '重试任务' : 'Retry task'}</Text></Pressable> : null}
                    </View>
                </View> : null}

            </ScrollView>
            {execution.sessionId ? (
                <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                    <View style={styles.bottomBarInner}>
                        <Pressable style={styles.sessionButton} onPress={() => navigateToSession(execution.sessionId!)}>
                            <Ionicons name="terminal-outline" size={17} color={theme.colors.button.primary.tint} />
                            <Text style={styles.sessionButtonText}>{isZh ? '打开执行 Session' : 'Open execution session'}</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}
        </View>
    );
}

import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { commandAiWorkItem, fetchAiExecutionEvents, fetchAiWorkspaces, fetchAiWorkspaceMembers, fetchAiWorkspaceGrants, fetchAiWorkspaceResources, removeAiWorkspaceMember,
    fetchAiWorkspaceWorkItem, fetchAiWorkspaceWorkItems, runAiWorkspaceProject,
    setAiWorkspaceGrant, setAiWorkspaceMember, steerAiWorkItem, updateAiWorkAcceptance, AiTeamRequestError, type AiWorkspace, type AiWorkspaceMember,
    type AiPersistentExecutionEvent, type AiWorkspaceResource, type AiWorkspaceWorkItem } from '@/sync/apiAiTeams';
import { withAiMutationIdentity } from '@/sync/aiMutationJournal';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 64, gap: 22 },
    section: { gap: 9 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    row: { minHeight: 45, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 3 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    input: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, color: theme.colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function AiWorkspacesPage() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const { credentials } = useAuth();
    const [workspaces, setWorkspaces] = React.useState<AiWorkspace[]>([]);
    const [workspaceId, setWorkspaceId] = React.useState('');
    const [members, setMembers] = React.useState<AiWorkspaceMember[]>([]);
    const [revision, setRevision] = React.useState<number | null>(null);
    const [resources, setResources] = React.useState<AiWorkspaceResource[]>([]);
    const [agents, setAgents] = React.useState<AiWorkspaceResource[]>([]);
    const [workItems, setWorkItems] = React.useState<AiWorkspaceWorkItem[]>([]);
    const [selectedWorkId, setSelectedWorkId] = React.useState('');
    const [auditEvents, setAuditEvents] = React.useState<AiPersistentExecutionEvent[]>([]);
    const [auditCursor, setAuditCursor] = React.useState(0);
    const [auditMore, setAuditMore] = React.useState(false);
    const [runAgentId, setRunAgentId] = React.useState('');
    const [runTitle, setRunTitle] = React.useState('');
    const [runSummary, setRunSummary] = React.useState('');
    const [kind, setKind] = React.useState<'project' | 'agent'>('project');
    const [resourceId, setResourceId] = React.useState('');
    const [memberId, setMemberId] = React.useState('');
    const [newAccountId, setNewAccountId] = React.useState('');
    const [newRole, setNewRole] = React.useState<'member' | 'admin'>('member');
    const [canView, setCanView] = React.useState(true);
    const [canRun, setCanRun] = React.useState(false);
    const [canApprove, setCanApprove] = React.useState(false);
    const [grantTouched, setGrantTouched] = React.useState(false);
    const [grantLoaded, setGrantLoaded] = React.useState(false);
    const [grantRevision, setGrantRevision] = React.useState<number | null>(null);
    const [grantStale, setGrantStale] = React.useState(false);
    const [serverGrant, setServerGrant] = React.useState<{ canView: boolean; canRun: boolean; canApprove: boolean; revision: number } | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const detailRequest = React.useRef(0);
    const workspaceRequest = React.useRef(0);
    const grantRequest = React.useRef(0);
    const selectedWork = workItems.find((item) => item.id === selectedWorkId);
    const selectedAuditId = selectedWork?.orchestratorExecutionId;
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const canAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

    const loadWorkspaces = React.useCallback(async () => {
        if (!credentials) return;
        const requestId = ++workspaceRequest.current;
        const result = await fetchAiWorkspaces(credentials);
        if (requestId !== workspaceRequest.current) return;
        setWorkspaces(result.items);
        setWorkspaceId((current) => result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? '');
    }, [credentials?.secret]);

    const loadDetails = React.useCallback(async () => {
        if (!credentials || !workspaceId) return;
        const requestId = ++detailRequest.current;
        let resourceResult: Awaited<ReturnType<typeof fetchAiWorkspaceResources>>;
        let agentResult: Awaited<ReturnType<typeof fetchAiWorkspaceResources>>;
        let workResult: Awaited<ReturnType<typeof fetchAiWorkspaceWorkItems>>;
        let memberResult: Awaited<ReturnType<typeof fetchAiWorkspaceMembers>> | null;
        try {
            [resourceResult, agentResult, workResult, memberResult] = await Promise.all([
                fetchAiWorkspaceResources(credentials, workspaceId, kind),
                fetchAiWorkspaceResources(credentials, workspaceId, 'agent'),
                fetchAiWorkspaceWorkItems(credentials, workspaceId),
                canAdmin ? fetchAiWorkspaceMembers(credentials, workspaceId) : Promise.resolve(null),
            ]);
        } catch (cause) {
            if (requestId === detailRequest.current) throw cause;
            return;
        }
        if (requestId !== detailRequest.current) return;
        setResources(resourceResult.items);
        setAgents(agentResult.items);
        setRunAgentId((current) => agentResult.items.some((item) => item.id === current) ? current : '');
        setWorkItems(workResult.items);
        setResourceId((current) => resourceResult.items.some((item) => item.id === current) ? current : '');
        setMembers(memberResult?.items ?? []);
        setRevision(memberResult?.authRevision ?? null);
    }, [credentials?.secret, workspaceId, kind, canAdmin]);

    React.useEffect(() => {
        workspaceRequest.current++;
        detailRequest.current++;
        setWorkspaces([]); setWorkspaceId(''); setMembers([]); setResources([]); setAgents([]);
        setWorkItems([]); setSelectedWorkId(''); setMemberId(''); setNewAccountId('');
        setNewRole('member'); setError(null);
        loadWorkspaces().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [loadWorkspaces]);
    React.useEffect(() => {
        detailRequest.current++;
        setMembers([]); setResources([]); setAgents([]); setWorkItems([]);
        setSelectedWorkId(''); setResourceId(''); setMemberId('');
        loadDetails().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [loadDetails]);
    React.useEffect(() => {
        const requestId = ++grantRequest.current;
        setCanView(false); setCanRun(false); setCanApprove(false); setGrantTouched(false);
        setGrantLoaded(false); setGrantRevision(null); setGrantStale(false); setServerGrant(null);
        if (!credentials || !workspaceId || !resourceId || !memberId || !canAdmin || memberId === workspace?.ownerAccountId) return;
        fetchAiWorkspaceGrants(credentials, workspaceId, memberId).then((snapshot) => {
            if (grantRequest.current !== requestId) return;
            const grant = snapshot.grants.find((item) => item.resourceKind === kind && item.resourceId === resourceId);
            setCanView(grant?.canView ?? false); setCanRun(grant?.canRun ?? false); setCanApprove(grant?.canApprove ?? false);
            setGrantRevision(snapshot.authRevision); setGrantLoaded(true);
        }).catch((cause) => {
            if (grantRequest.current === requestId) setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { grantRequest.current++; };
    }, [credentials?.secret, workspaceId, kind, resourceId, memberId, canAdmin, workspace?.ownerAccountId]);
    React.useEffect(() => {
        let active = true;
        setAuditEvents([]); setAuditCursor(0); setAuditMore(false);
        if (credentials && selectedAuditId) {
            fetchAiExecutionEvents(credentials, selectedAuditId).then((result) => {
                if (!active) return;
                setAuditEvents(result.items); setAuditCursor(result.nextAfterSeq);
                setAuditMore(result.items.length === 50);
            }).catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : String(cause));
            });
        }
        return () => { active = false; };
    }, [credentials?.secret, selectedAuditId]);

    const perform = async (work: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await work(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    const refreshWorkItems = async () => {
        if (!credentials || !workspaceId) return;
        const result = await fetchAiWorkspaceWorkItems(credentials, workspaceId);
        setWorkItems(result.items);
        if (selectedWorkId) {
            const detail = await fetchAiWorkspaceWorkItem(credentials, workspaceId, selectedWorkId);
            setWorkItems((items) => items.map((item) => item.id === detail.id ? detail : item));
        }
    };
    const selectedProject = resources.find((item) => item.id === resourceId);
    const loadMoreAudit = async () => {
        if (!credentials || !selectedAuditId || !auditMore) return;
        const result = await fetchAiExecutionEvents(credentials, selectedAuditId, auditCursor);
        setAuditEvents((current) => [...current, ...result.items]);
        setAuditCursor(result.nextAfterSeq); setAuditMore(result.items.length === 50);
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '工作空间权限' : 'Workspace access' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '工作空间' : 'Workspaces'}</Text>
                {workspaces.map((item) => <Pressable key={item.id} style={[styles.row, item.id === workspaceId && styles.selected]} onPress={() => { setWorkspaceId(item.id); setNewAccountId(''); setNewRole('member'); }}>
                    <Text style={styles.text}>{item.name}</Text><Text style={styles.muted}>{item.role} · {item.id}</Text>
                </Pressable>)}
                {!workspaces.length ? <Text style={styles.muted}>{isZh ? '暂无可访问的工作空间' : 'No accessible workspaces'}</Text> : null}
            </View>
            {workspace ? <>
                <View style={styles.section}>
                    <Text style={styles.heading}>{isZh ? '可见资源' : 'Visible resources'}</Text>
                    <View style={styles.actions}>{(['project', 'agent'] as const).map((value) => <Pressable key={value} style={[styles.action, kind === value && styles.selected]} onPress={() => { setKind(value); setResourceId(''); }}><Text style={styles.actionText}>{value === 'project' ? (isZh ? '项目' : 'Projects') : 'Agents'}</Text></Pressable>)}</View>
                    {resources.map((item) => <Pressable key={item.id} style={[styles.row, item.id === resourceId && styles.selected]} onPress={() => setResourceId(item.id)}><Text style={styles.text}>{item.name}</Text><Text style={styles.muted}>{item.id}</Text></Pressable>)}
                    {!resources.length ? <Text style={styles.muted}>{isZh ? '没有可见资源' : 'No visible resources'}</Text> : null}
                </View>
                <View style={styles.section}>
                    <Text style={styles.heading}>{isZh ? '项目执行' : 'Project run'}</Text>
                    {kind === 'project' && selectedProject?.active ? <>
                        <Text style={styles.muted}>{selectedProject.name} · v{selectedProject.currentVersion}</Text>
                        <View style={styles.actions}>{agents.filter((item) => item.enabled).map((item) => <Pressable key={item.id}
                            style={[styles.action, runAgentId === item.id && styles.selected]} onPress={() => setRunAgentId(item.id)}>
                            <Text style={styles.actionText}>{item.name}</Text>
                        </Pressable>)}</View>
                        <TextInput style={styles.input} value={runTitle} onChangeText={setRunTitle}
                            placeholder={isZh ? '任务标题' : 'Task title'} placeholderTextColor={theme.colors.textSecondary} />
                        <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline
                            value={runSummary} onChangeText={setRunSummary}
                            placeholder={isZh ? '任务需求' : 'Task requirements'} placeholderTextColor={theme.colors.textSecondary} />
                        <Pressable style={styles.action} disabled={busy || !credentials || !runAgentId || !runTitle.trim() || !runSummary.trim()}
                            onPress={() => perform(async () => {
                                if (!credentials) return;
                                const projectId = selectedProject.id;
                                const title = runTitle.trim(); const summary = runSummary.trim();
                                const detail = await withAiMutationIdentity(credentials, `workspace-run:${workspaceId}:${projectId}`,
                                    { agentId: runAgentId, title, summary },
                                    async (clientRequestId) => {
                                        const result = await runAiWorkspaceProject(credentials, workspaceId, projectId,
                                            { clientRequestId, agentId: runAgentId, title, summary });
                                        return fetchAiWorkspaceWorkItem(credentials, workspaceId, result.workItemId);
                                    });
                                setWorkItems((items) => [detail, ...items.filter((item) => item.id !== detail.id)]);
                                setSelectedWorkId(detail.id);
                                setRunTitle(''); setRunSummary('');
                            })}><Ionicons name="play-outline" size={17} color={theme.colors.text} />
                            <Text style={styles.actionText}>{isZh ? '运行项目' : 'Run project'}</Text></Pressable>
                    </> : <Text style={styles.muted}>{isZh ? '选择一个可运行项目' : 'Select an active project'}</Text>}
                    {kind === 'project' && selectedProject?.active && !agents.some((item) => item.enabled)
                        ? <Text style={styles.muted}>{isZh ? '没有可用的 Agent 权限' : 'No available agent access'}</Text> : null}
                </View>
                <View style={styles.section}>
                    <View style={styles.actions}><Text style={styles.heading}>{isZh ? '工作任务' : 'Work items'}</Text>
                        <Pressable style={styles.action} disabled={busy} onPress={() => perform(refreshWorkItems)}
                            accessibilityLabel={isZh ? '刷新工作任务' : 'Refresh work items'}>
                            <Ionicons name="refresh-outline" size={17} color={theme.colors.text} /></Pressable></View>
                    {workItems.map((item) => <Pressable key={item.id} style={[styles.row, selectedWorkId === item.id && styles.selected]}
                        onPress={() => perform(async () => {
                            if (!credentials) return;
                            const detail = await fetchAiWorkspaceWorkItem(credentials, workspaceId, item.id);
                            setWorkItems((current) => current.map((entry) => entry.id === detail.id ? detail : entry));
                            setSelectedWorkId(detail.id);
                        })}><Text style={styles.text}>{item.title}</Text>
                        <Text style={styles.muted}>{item.runStatus} · {item.projectVersion != null ? `v${item.projectVersion}` : '—'} · {item.acceptanceStatus}</Text>
                    </Pressable>)}
                    {selectedWork ? <View style={styles.section}><Text style={styles.text}>{selectedWork.summary}</Text>
                        <Text style={styles.muted}>{selectedWork.runStatus} · {selectedWork.deliveryVerificationStatus}</Text>
                        <Text style={styles.muted} selectable>{isZh ? '任务' : 'Task'}: {selectedWork.orchestratorTaskId} · {isZh ? '执行' : 'Execution'}: {selectedWork.orchestratorExecutionId ?? '—'}</Text>
                        <Text style={styles.muted}>rev {selectedWork.workspaceAuthRevision} · {selectedWork.taskStatus ?? '—'} · {selectedWork.latestExecutionStatus ?? '—'}</Text>
                        <View style={styles.actions}>
                            <Pressable style={styles.action} onPress={() => router.push(`/settings/workspaces/work/${selectedWork.id}?workspaceId=${encodeURIComponent(workspaceId)}` as never)}>
                                <Ionicons name="open-outline" size={17} color={theme.colors.text} />
                                <Text style={styles.actionText}>{isZh ? '资料与评论' : 'Details and comments'}</Text></Pressable>
                            {(['cancel', 'retry'] as const).filter((action) => selectedWork.availableActions.includes(action)).map((action) =>
                                <Pressable key={action} style={styles.action} disabled={busy} onPress={() => perform(async () => {
                                    if (!credentials || !await Modal.confirm(action === 'cancel'
                                        ? (isZh ? '取消任务？' : 'Cancel task?') : (isZh ? '重试失败任务？' : 'Retry failed task?'), selectedWork.title)) return;
                                    await withAiMutationIdentity(credentials, `workspace-${action}:${selectedWork.id}`,
                                        { workItemId: selectedWork.id, action },
                                        (clientRequestId) => commandAiWorkItem(credentials, selectedWork.id, action, clientRequestId));
                                    await refreshWorkItems();
                                })}><Ionicons name={action === 'cancel' ? 'stop-outline' : 'refresh-outline'} size={17} color={theme.colors.text} />
                                    <Text style={styles.actionText}>{action === 'cancel' ? (isZh ? '取消' : 'Cancel') : (isZh ? '重试' : 'Retry')}</Text></Pressable>)}
                            {selectedWork.availableActions.includes('steering') ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                                if (!credentials) return;
                                const text = await Modal.prompt(isZh ? '补充任务要求' : 'Steer task', selectedWork.title,
                                    { placeholder: isZh ? '补充要求' : 'Additional requirement' });
                                if (!text?.trim()) return;
                                await withAiMutationIdentity(credentials, `workspace-steer:${selectedWork.id}`,
                                    { workItemId: selectedWork.id, targetTaskId: selectedWork.orchestratorTaskId, text: text.trim() },
                                    (clientRequestId) => steerAiWorkItem(credentials, selectedWork.id,
                                        { clientRequestId, targetTaskId: selectedWork.orchestratorTaskId, text: text.trim() }));
                                await refreshWorkItems();
                            })}><Ionicons name="send-outline" size={17} color={theme.colors.text} />
                                <Text style={styles.actionText}>{isZh ? '补充要求' : 'Steer'}</Text></Pressable> : null}
                            {(['approve', 'changes_requested'] as const).filter((action) => selectedWork.availableActions.includes(action)).map((action) =>
                                <Pressable key={action} style={styles.action} disabled={busy || !selectedWork.orchestratorExecutionId} onPress={() => perform(async () => {
                                    if (!credentials || !selectedWork.orchestratorExecutionId) return;
                                    const reviewedExecutionId = selectedWork.orchestratorExecutionId;
                                    if (!await Modal.confirm(action === 'approve'
                                        ? (isZh ? '批准当前结果？' : 'Approve reviewed result?')
                                        : (isZh ? '请求修改当前结果？' : 'Request changes to reviewed result?'),
                                    `${selectedWork.title}\nExecution: ${reviewedExecutionId}`)) return;
                                    try {
                                        await withAiMutationIdentity(credentials, `workspace-accept:${selectedWork.id}`,
                                            { workItemId: selectedWork.id, status: action, reviewedExecutionId },
                                            (clientMessageId) => updateAiWorkAcceptance(credentials, selectedWork.id,
                                                action === 'approve' ? 'approved' : 'changes_requested', undefined, clientMessageId, reviewedExecutionId));
                                        await refreshWorkItems();
                                    } catch (cause) {
                                        if (cause instanceof AiTeamRequestError && cause.status === 409) {
                                            throw new Error(isZh ? '结果已更新，请刷新后重新审阅。' : 'Result changed; refresh and review again.');
                                        }
                                        throw cause;
                                    }
                                })}><Ionicons name={action === 'approve' ? 'checkmark-outline' : 'create-outline'} size={17} color={theme.colors.text} />
                                    <Text style={styles.actionText}>{action === 'approve' ? (isZh ? '批准' : 'Approve') : (isZh ? '请求修改' : 'Request changes')}</Text></Pressable>)}
                        </View>
                        {selectedAuditId ? <View style={styles.section}>
                            <Text style={styles.heading}>{isZh ? '审计事件' : 'Audit events'} · {auditEvents.length}</Text>
                            {auditEvents.map((event) => <View key={event.eventId} style={styles.row}>
                                <Text style={styles.muted}>{event.seq} · {event.kind} · {event.phase}</Text>
                                <Text style={styles.text}>{event.redactedSummary}</Text>
                            </View>)}
                            {auditMore ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(loadMoreAudit)}>
                                <Ionicons name="chevron-down-outline" size={17} color={theme.colors.text} />
                                <Text style={styles.actionText}>{isZh ? '更多事件' : 'More events'}</Text>
                            </Pressable> : null}
                        </View> : null}
                    </View> : null}
                </View>
                {canAdmin ? <>
                    <View style={styles.section}>
                        <Text style={styles.heading}>{isZh ? '成员' : 'Members'}{revision !== null ? ` · rev ${revision}` : ''}</Text>
                        {members.map((member) => <Pressable key={member.memberAccountId} style={[styles.row, memberId === member.memberAccountId && styles.selected]} onPress={() => {
                            setMemberId(member.memberAccountId);
                            if (member.role !== 'owner') { setNewAccountId(member.memberAccountId); setNewRole(member.role); }
                            else { setNewAccountId(''); setNewRole('member'); }
                        }}>
                            <Text style={styles.text}>{member.memberAccountId}</Text><Text style={styles.muted}>{member.role}</Text>
                        </Pressable>)}
                        <TextInput style={styles.input} value={newAccountId} onChangeText={setNewAccountId} autoCapitalize="none" placeholder={isZh ? '成员账号 ID' : 'Member account ID'} placeholderTextColor={theme.colors.textSecondary} />
                        <View style={styles.actions}>{(['member', 'admin'] as const).map((role) => <Pressable key={role} style={[styles.action, newRole === role && styles.selected]} onPress={() => setNewRole(role)}><Text style={styles.actionText}>{role}</Text></Pressable>)}</View>
                        <View style={styles.actions}>
                            <Pressable style={styles.action} disabled={busy || !newAccountId.trim()} onPress={() => perform(async () => {
                                if (!credentials) return;
                                await setAiWorkspaceMember(credentials, workspaceId, newAccountId.trim(), newRole);
                                setMemberId(newAccountId.trim()); setNewAccountId(''); await loadDetails();
                            })}><Ionicons name="person-add-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '添加或更新' : 'Add or update'}</Text></Pressable>
                            {memberId && memberId !== workspace.ownerAccountId ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                                if (!credentials || !await Modal.confirm(isZh ? '移除成员？' : 'Remove member?', memberId)) return;
                                await removeAiWorkspaceMember(credentials, workspaceId, memberId);
                                setMemberId(''); await loadDetails();
                            })}><Ionicons name="person-remove-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '移除' : 'Remove'}</Text></Pressable> : null}
                        </View>
                    </View>
                    {memberId && memberId !== workspace.ownerAccountId && resourceId ? <View style={styles.section}>
                        <Text style={styles.heading}>{isZh ? '资源权限' : 'Resource access'}</Text>
                        <Text style={styles.muted}>{memberId} · {resources.find((item) => item.id === resourceId)?.name}</Text>
                        <Text style={styles.muted}>{grantLoaded
                            ? `${isZh ? '已载入权限' : 'Access loaded'} · rev ${grantRevision}`
                            : (isZh ? '正在载入当前权限' : 'Loading current access')}</Text>
                        <View style={styles.actions}>{([
                            ['View', canView, setCanView], ['Run', canRun, setCanRun], ['Approve', canApprove, setCanApprove],
                        ] as const).map(([label, checked, setChecked]) => <Pressable key={label} style={[styles.action, checked && styles.selected]} disabled={!grantLoaded || busy} onPress={() => { setChecked(!checked); setGrantTouched(true); }} accessibilityRole="checkbox" accessibilityState={{ checked }} aria-checked={checked}>
                            <Ionicons name={checked ? 'checkbox-outline' : 'square-outline'} size={18} color={theme.colors.text} /><Text style={styles.actionText}>{label}</Text>
                        </Pressable>)}</View>
                        {grantStale ? <View style={styles.section}>
                            <Text style={styles.error}>{isZh ? '权限已由其他人更新；当前勾选尚未提交。' : 'Access changed elsewhere; your selection was not saved.'}</Text>
                            {serverGrant ? <Text style={styles.muted}>{isZh ? '服务端现值' : 'Current server access'} · rev {serverGrant.revision} · {[
                                serverGrant.canView && 'View', serverGrant.canRun && 'Run', serverGrant.canApprove && 'Approve',
                            ].filter(Boolean).join(', ') || (isZh ? '无权限' : 'No access')}</Text> : null}
                            <Pressable style={styles.action} onPress={async () => {
                                if (!credentials || !await Modal.confirm(isZh ? '载入最新权限？' : 'Load current access?',
                                    isZh ? '未提交的勾选将被替换。' : 'Your unsaved selection will be replaced.')) return;
                                const snapshot = await fetchAiWorkspaceGrants(credentials, workspaceId, memberId);
                                const grant = snapshot.grants.find((item) => item.resourceKind === kind && item.resourceId === resourceId);
                                setCanView(grant?.canView ?? false); setCanRun(grant?.canRun ?? false);
                                setCanApprove(grant?.canApprove ?? false); setGrantRevision(snapshot.authRevision);
                                setGrantStale(false); setGrantTouched(false); setServerGrant(null); setError(null);
                            }}><Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                                <Text style={styles.actionText}>{isZh ? '载入最新权限' : 'Load current access'}</Text></Pressable>
                        </View> : null}
                        <Pressable style={styles.action} disabled={busy || !grantLoaded || grantStale || grantRevision === null || !grantTouched || (!canView && (canRun || canApprove))} onPress={() => perform(async () => {
                            if (!credentials || !await Modal.confirm(isZh ? '替换该资源的权限？' : 'Replace resource access?',
                                isZh ? '将以本次选择覆盖已保存的权限。' : 'The selected permissions will replace saved access.',
                                { confirmText: isZh ? '确认替换' : 'Replace' })) return;
                            try {
                                const requestId = grantRequest.current;
                                await setAiWorkspaceGrant(credentials, workspaceId, { memberAccountId: memberId, resourceKind: kind,
                                    resourceId, canView, canRun, canApprove, expectedAuthRevision: grantRevision! });
                                if (requestId !== grantRequest.current) return;
                            } catch (cause) {
                                if (!(cause instanceof AiTeamRequestError) || cause.status !== 409) throw cause;
                                const requestId = grantRequest.current;
                                const snapshot = await fetchAiWorkspaceGrants(credentials, workspaceId, memberId);
                                if (requestId !== grantRequest.current) return;
                                const current = snapshot.grants.find((item) => item.resourceKind === kind && item.resourceId === resourceId);
                                setServerGrant({ canView: current?.canView ?? false, canRun: current?.canRun ?? false,
                                    canApprove: current?.canApprove ?? false, revision: snapshot.authRevision });
                                setGrantStale(true);
                                return;
                            }
                            setGrantTouched(false);
                            const requestId = grantRequest.current;
                            const snapshot = await fetchAiWorkspaceGrants(credentials, workspaceId, memberId);
                            if (requestId !== grantRequest.current) return;
                            setGrantRevision(snapshot.authRevision);
                            await loadDetails();
                        })}><Ionicons name="save-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '保存权限' : 'Save access'}</Text></Pressable>
                    </View> : null}
                </> : null}
            </> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

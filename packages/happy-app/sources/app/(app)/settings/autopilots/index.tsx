import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { createAiAutopilot, fetchAiAutopilotRuns, fetchAiAutopilots, fetchAiProjects, fetchAiTeamState, runAiAutopilot, setAiAutopilotEnabled,
    type AiAutopilot, type AiAutopilotRun, type AiProject } from '@/sync/apiAiTeams';
import { withAiMutationIdentity } from '@/sync/aiMutationJournal';
import { getCurrentLanguage } from '@/text';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 64, gap: 18 },
    section: { gap: 9 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    row: { minHeight: 48, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 3 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    input: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, color: theme.colors.text },
    editor: { minHeight: 95, textAlignVertical: 'top', paddingVertical: 9 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function AiAutopilotsPage() {
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const { credentials } = useAuth();
    const router = useRouter();
    const teamData = useManagedAiTeamData();
    const [projects, setProjects] = React.useState<AiProject[]>([]);
    const [rules, setRules] = React.useState<AiAutopilot[]>([]);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [runs, setRuns] = React.useState<AiAutopilotRun[]>([]);
    const [projectId, setProjectId] = React.useState('');
    const [agentId, setAgentId] = React.useState('');
    const [name, setName] = React.useState('');
    const [prompt, setPrompt] = React.useState('');
    const [trigger, setTrigger] = React.useState<'manual' | 'cron'>('manual');
    const [cron, setCron] = React.useState('0 9 * * *');
    const [timezone, setTimezone] = React.useState('UTC');
    const [action, setAction] = React.useState<'run_only' | 'create_issue'>('run_only');
    const [policy, setPolicy] = React.useState<'skip' | 'queue' | 'replace'>('skip');
    const [catchup, setCatchup] = React.useState('1');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const selected = rules.find((rule) => rule.id === selectedId);
    const chosenProject = projects.find((project) => project.id === projectId);

    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const [projectResult, ruleResult] = await Promise.all([fetchAiProjects(credentials), fetchAiAutopilots(credentials)]);
        setProjects(projectResult.items); setRules(ruleResult.items);
    }, [credentials?.secret]);

    React.useEffect(() => {
        setProjects([]); setRules([]); setSelectedId(null); setRuns([]); setError(null);
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [refresh]);

    React.useEffect(() => {
        if (!credentials || !selectedId) { setRuns([]); return; }
        fetchAiAutopilotRuns(credentials, selectedId).then((result) => setRuns(result.items))
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [credentials?.secret, selectedId]);

    const perform = async (work: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await work(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '自动任务' : 'Autopilot' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '自动任务' : 'Autopilot'} · {rules.length}</Text>
                {rules.map((rule) => <Pressable key={rule.id} style={[styles.row, selectedId === rule.id && styles.selected]} onPress={() => setSelectedId(rule.id)}>
                    <Text style={styles.text}>{rule.name}</Text>
                    <Text style={styles.muted}>{rule.enabled ? (isZh ? '启用' : 'Enabled') : (isZh ? '停用' : 'Disabled')} · {rule.triggerKind === 'cron' ? `${rule.cronExpression} ${rule.timezone}` : rule.triggerKind} · {rule.action}</Text>
                </Pressable>)}
                {!rules.length ? <Text style={styles.muted}>{isZh ? '暂无规则' : 'No rules'}</Text> : null}
            </View>
            {selected ? <View style={styles.section}>
                <Text style={styles.heading}>{selected.name}</Text>
                <View style={styles.actions}>
                    <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        await setAiAutopilotEnabled(credentials, selected.id, !selected.enabled);
                        await refresh();
                    })}><Ionicons name={selected.enabled ? 'pause-outline' : 'play-outline'} size={17} color={theme.colors.text} /><Text style={styles.actionText}>{selected.enabled ? (isZh ? '停用' : 'Disable') : (isZh ? '启用' : 'Enable')}</Text></Pressable>
                    {selected.enabled ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        await withAiMutationIdentity(credentials, `autopilot-run:${selected.id}`, { action: 'manual-run' },
                            (clientRequestId) => runAiAutopilot(credentials, selected.id, clientRequestId));
                        setRuns((await fetchAiAutopilotRuns(credentials, selected.id)).items);
                    })}><Ionicons name="play-circle-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '立即运行' : 'Run now'}</Text></Pressable> : null}
                    <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        setRuns((await fetchAiAutopilotRuns(credentials, selected.id)).items);
                    })}><Ionicons name="refresh-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '刷新历史' : 'Refresh history'}</Text></Pressable>
                </View>
                {runs.map((run) => <Pressable key={run.id} style={styles.row} disabled={!run.workItemId} onPress={() => perform(async () => {
                    if (!credentials || !run.workItemId) return;
                    const state = await fetchAiTeamState(credentials);
                    const work = state.workItems.find((item) => item.id === run.workItemId);
                    if (!work?.executionIds[0]) throw new Error(isZh ? '尚未创建执行记录，请刷新历史' : 'Execution is not available yet. Refresh history.');
                    router.push(`/inbox/ai/executions/${work.executionIds[0]}` as never);
                })}>
                    <Text style={styles.text}>{run.status === 'submitted' ? (isZh ? '已提交调度' : 'Dispatch submitted') : run.status} · {new Date(run.plannedAt).toLocaleString()}</Text>
                    <Text style={styles.muted}>{run.triggerKey} · {isZh ? '尝试' : 'Attempts'} {run.attempts}{run.errorCode ? ` · ${run.errorCode}` : ''}</Text>
                    {run.workItemId ? <Text style={styles.muted}>{isZh ? '任务' : 'Work item'} {run.workItemId}</Text> : null}
                </Pressable>)}
            </View> : null}
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '新规则' : 'New rule'}</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={isZh ? '名称' : 'Name'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={[styles.input, styles.editor]} multiline value={prompt} onChangeText={setPrompt} placeholder={isZh ? '任务需求' : 'Task request'} placeholderTextColor={theme.colors.textSecondary} />
                <Text style={styles.muted}>{isZh ? '项目' : 'Project'}</Text>
                {projects.filter((project) => project.active).map((project) => <Pressable key={project.id} style={[styles.row, projectId === project.id && styles.selected]} onPress={() => {
                    setProjectId(project.id); if (project.snapshot?.kind === 'local') setAction('run_only');
                }}><Text style={styles.text}>{project.name}</Text><Text style={styles.muted}>v{project.version} · {project.snapshot?.kind} · {project.snapshot?.baseCommit.slice(0, 12)}</Text></Pressable>)}
                <Text style={styles.muted}>{isZh ? '负责人' : 'Assignee'}</Text>
                {teamData.agents.filter((agent) => agent.enabled !== false).map((agent) => <Pressable key={agent.id} style={[styles.row, agentId === agent.id && styles.selected]} onPress={() => setAgentId(agent.id)}><Text style={styles.text}>{agent.name}</Text></Pressable>)}
                <View style={styles.actions}>{(['manual', 'cron'] as const).map((value) => <Pressable key={value} style={[styles.action, trigger === value && styles.selected]} onPress={() => setTrigger(value)}><Text style={styles.actionText}>{value === 'manual' ? (isZh ? '手动' : 'Manual') : 'Cron'}</Text></Pressable>)}</View>
                {trigger === 'cron' ? <View style={styles.actions}>
                    <TextInput style={[styles.input, { flex: 2, minWidth: 150 }]} value={cron} onChangeText={setCron} placeholder="0 9 * * *" placeholderTextColor={theme.colors.textSecondary} />
                    <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={timezone} onChangeText={setTimezone} placeholder="UTC" placeholderTextColor={theme.colors.textSecondary} />
                </View> : null}
                <View style={styles.actions}>{(['run_only', 'create_issue'] as const).map((value) => <Pressable key={value} style={[styles.action, action === value && styles.selected]} disabled={value === 'create_issue' && chosenProject?.snapshot?.kind !== 'github'} onPress={() => setAction(value)}><Text style={styles.actionText}>{value === 'run_only' ? (isZh ? '仅运行' : 'Run only') : (isZh ? '创建 Issue' : 'Create issue')}</Text></Pressable>)}</View>
                <View style={styles.actions}>{(['skip', 'queue', 'replace'] as const).map((value) => <Pressable key={value} style={[styles.action, policy === value && styles.selected]} onPress={() => setPolicy(value)}><Text style={styles.actionText}>{value}</Text></Pressable>)}</View>
                <TextInput style={styles.input} value={catchup} onChangeText={setCatchup} keyboardType="number-pad" placeholder={isZh ? '补运行上限' : 'Catch-up limit'} placeholderTextColor={theme.colors.textSecondary} />
                <Pressable style={styles.action} disabled={busy || !projectId || !agentId || !name.trim() || !prompt.trim()} onPress={() => perform(async () => {
                    if (!credentials) throw new Error('Authentication is required');
                    const catchupLimit = Number(catchup);
                    if (!Number.isInteger(catchupLimit) || catchupLimit < 1 || catchupLimit > 24) throw new Error(isZh ? '补运行上限应为 1-24' : 'Catch-up limit must be 1-24');
                    await createAiAutopilot(credentials, { name: name.trim(), prompt: prompt.trim(), projectId, agentId,
                        triggerKind: trigger, ...(trigger === 'cron' ? { cronExpression: cron.trim(), timezone: timezone.trim() } : {}),
                        action, concurrencyPolicy: policy, catchupLimit });
                    setName(''); setPrompt(''); await refresh();
                })}><Ionicons name="add" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '创建规则' : 'Create rule'}</Text></Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

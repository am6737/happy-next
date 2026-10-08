import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useManagedAiTeamData, createManagedAiAssignment } from '@/features/aiTeams/agentStore';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { padding: 20, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
    label: { color: theme.colors.text, fontWeight: '600' },
    input: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 10, padding: 12, color: theme.colors.text },
    row: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 10, padding: 14, gap: 4 },
    selected: { borderColor: theme.colors.textLink, backgroundColor: theme.colors.surfaceHigh },
    name: { color: theme.colors.text, fontWeight: '600' },
    detail: { color: theme.colors.textSecondary },
    submit: { borderRadius: 10, padding: 15, alignItems: 'center', backgroundColor: theme.colors.button.primary.background },
    submitDisabled: { opacity: 0.45 },
    submitText: { color: theme.colors.button.primary.tint, fontWeight: '600' },
}));

export default function AssignGithubIssuePage() {
    const isZh = getCurrentLanguage().startsWith('zh');
    const router = useRouter();
    const { owner, repo, number, title: initialTitle, body: initialBody } = useLocalSearchParams<{ owner: string; repo: string; number: string; title?: string; body?: string }>();
    const data = useManagedAiTeamData();
    const available = data.agents.filter((agent) => agent.enabled !== false && agent.availability === 'online');
    const [agentId, setAgentId] = React.useState('');
    const [title, setTitle] = React.useState(initialTitle ?? `Issue #${number}`);
    const [summary, setSummary] = React.useState(initialBody ?? '');
    const [submitting, setSubmitting] = React.useState(false);
    const selected = available.find((agent) => agent.id === agentId) ?? available[0];
    const canSubmit = Boolean(selected && title.trim() && summary.trim() && !submitting);

    const submit = async () => {
        if (!selected || !title.trim() || !summary.trim() || submitting) return;
        setSubmitting(true);
        try {
            const result = await createManagedAiAssignment({
                agent: selected,
                teamId: selected.teamIds[0] ?? '',
                title: title.trim(),
                summary: `${summary.trim()}\n\nGitHub Issue: https://github.com/${owner}/${repo}/issues/${number}`,
                isZh,
                sourceType: 'github',
                sourceLabel: `GitHub ${owner}/${repo}#${number}`,
                sourceResourceId: `${owner}/${repo}#${number}`,
            });
            router.replace(`/inbox/ai/executions/${result.execution.id}` as never);
        } catch (error) {
            setSubmitting(false);
            Modal.alert(isZh ? '无法分配 Issue' : 'Could not assign issue', error instanceof Error ? error.message : undefined);
        }
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '交给 AI 团队' : 'Assign to AI team' }} />
        <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.label}>{isZh ? '任务标题' : 'Task title'}</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} />
            <Text style={styles.label}>{isZh ? 'Issue 内容与验收要求' : 'Issue details and acceptance criteria'}</Text>
            <TextInput value={summary} onChangeText={setSummary} multiline style={[styles.input, { minHeight: 150, textAlignVertical: 'top' }]} />
            <Text style={styles.label}>{isZh ? '选择在线 Agent' : 'Choose an online agent'}</Text>
            {available.map((agent) => <Pressable key={agent.id} onPress={() => setAgentId(agent.id)} style={[styles.row, selected?.id === agent.id && styles.selected]}><Text style={styles.name}>{agent.emoji} {agent.name}</Text><Text style={styles.detail}>{agent.role} · {agent.settings.engine}</Text></Pressable>)}
            {!available.length ? <Text style={styles.detail}>{isZh ? '没有在线且已安装对应 CLI 的 Agent。请先连接 Runtime。' : 'No online agent runtime is available.'}</Text> : null}
            <Pressable onPress={submit} disabled={!canSubmit} style={[styles.submit, !canSubmit && styles.submitDisabled]}><Text style={styles.submitText}>{submitting ? (isZh ? '正在创建…' : 'Creating…') : (isZh ? '创建任务并开始执行' : 'Create and start')}</Text></Pressable>
        </ScrollView>
    </View>;
}

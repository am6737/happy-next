import * as React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { RoundButton } from '@/components/RoundButton';
import { AiIdentityAvatar } from '@/features/aiTeams/components';
import { createManagedAiAssignment, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiAgent } from '@/features/aiTeams/types';
import { getCurrentLanguage } from '@/text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 130, gap: 26 },
    agent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    agentBody: { flex: 1 },
    agentName: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 16 },
    agentRole: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, marginTop: 3 },
    section: { gap: 10 },
    label: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    help: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    input: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, color: theme.colors.text, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.colors.surface },
    summary: { minHeight: 118, textAlignVertical: 'top' },
    teamList: { gap: 8 },
    teamRow: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
    teamSelected: { borderColor: theme.colors.textLink, backgroundColor: theme.colors.surfaceHigh },
    teamName: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14, flex: 1 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.surface, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, alignItems: 'center' },
    footerInner: { width: '100%', maxWidth: 684 },
}));

export default function AssignAgentWorkPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const isZh = getCurrentLanguage().startsWith('zh');
    const data = useManagedAiTeamData();
    const agent = findAiAgent(data, id);
    const availableTeams = data.teams.filter((team) => team.memberIds.includes(id));
    const [title, setTitle] = React.useState('');
    const [summary, setSummary] = React.useState('');
    const [teamId, setTeamId] = React.useState(availableTeams[0]?.id ?? '');
    const [submitting, setSubmitting] = React.useState(false);
    const valid = Boolean(agent && title.trim() && summary.trim());

    if (!agent) return <View style={styles.screen}><Text style={{ color: theme.colors.textSecondary, padding: 24 }}>{isZh ? '没有找到这个 Agent' : 'Agent not found'}</Text></View>;

    const submit = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            const result = await createManagedAiAssignment({ agent, teamId, title: title.trim(), summary: summary.trim(), isZh });
            router.replace(`/inbox/ai/executions/${result.execution.id}` as never);
        } catch (error) {
            Modal.alert(isZh ? '无法创建任务' : 'Could not create task', error instanceof Error ? error.message : undefined);
            setSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerTitle: isZh ? '分配工作' : 'Assign work' }} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.agent}>
                    <AiIdentityAvatar id={agent.id} name={agent.name} size={46} />
                    <View style={styles.agentBody}><Text style={styles.agentName}>{agent.name}</Text><Text style={styles.agentRole}>{agent.role}</Text></View>
                </View>
                <View style={styles.section}>
                    <Text style={styles.label}>{isZh ? '工作目标' : 'Goal'}</Text>
                    <TextInput value={title} onChangeText={setTitle} placeholder={isZh ? '例如：完善账号切换后的设备绑定流程' : 'e.g. Improve device binding after account switching'} placeholderTextColor={theme.colors.textSecondary} style={styles.input} />
                </View>
                <View style={styles.section}>
                    <Text style={styles.label}>{isZh ? '要求与交付标准' : 'Requirements and delivery criteria'}</Text>
                    <TextInput value={summary} onChangeText={setSummary} multiline placeholder={isZh ? '说明需要解决的问题、约束条件和期望结果。' : 'Describe the problem, constraints, and expected result.'} placeholderTextColor={theme.colors.textSecondary} style={[styles.input, styles.summary]} />
                    <Text style={styles.help}>{isZh ? '提交后会创建真实执行任务，并由在线 CLI runtime 领取。' : 'Submitting creates a real task for an online CLI runtime.'}</Text>
                </View>
                {availableTeams.length ? (
                    <View style={styles.section}>
                        <Text style={styles.label}>{isZh ? '关联团队' : 'Team'}</Text>
                        <View style={styles.teamList}>{availableTeams.map((team) => {
                            const selected = team.id === teamId;
                            return <Pressable key={team.id} style={[styles.teamRow, selected && styles.teamSelected]} onPress={() => setTeamId(team.id)}><Text style={styles.teamName}>{team.name}</Text>{selected ? <Ionicons name="checkmark-circle" size={19} color={theme.colors.textLink} /> : null}</Pressable>;
                        })}</View>
                    </View>
                ) : null}
            </ScrollView>
            <View style={styles.footer}><View style={styles.footerInner}><RoundButton size="large" title={submitting ? (isZh ? '正在创建…' : 'Creating…') : (isZh ? '创建并开始执行' : 'Create and start')} disabled={!valid || submitting} onPress={submit} /></View></View>
        </KeyboardAvoidingView>
    );
}

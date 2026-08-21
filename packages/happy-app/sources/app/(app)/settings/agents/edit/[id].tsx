import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { RoundButton } from '@/components/RoundButton';
import { AgentDefinitionForm } from '@/features/aiTeams/AgentDefinitionForm';
import { applyAiAgentDraft, cloneAiAgentDraft, type AiAgentDraft } from '@/features/aiTeams/agentDefinition';
import { saveManagedAiAgent, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiAgent } from '@/features/aiTeams/types';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    scrollContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: { xs: 24, md: 34 }, paddingBottom: 140 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 82, borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface, paddingHorizontal: { xs: 16, md: 24 }, paddingVertical: 14, alignItems: 'center' },
    footerContent: { width: '100%', maxWidth: 704, flexDirection: 'row', justifyContent: 'flex-end' },
    footerButton: { minWidth: { xs: '100%', md: 160 } },
    missing: { padding: 24, textAlign: 'center', color: theme.colors.textSecondary },
}));

function cloneDraft(draft: AiAgentDraft): AiAgentDraft {
    return {
        ...draft,
        responsibilities: [...draft.responsibilities],
        skills: [...draft.skills],
        settings: { ...draft.settings },
    };
}

export default function EditAiAgentPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const styles = stylesheet;
    const isZh = getCurrentLanguage().startsWith('zh');
    const data = useManagedAiTeamData();
    const agent = findAiAgent(data, id);
    const [draft, setDraft] = React.useState<AiAgentDraft | null>(() => agent ? cloneAiAgentDraft(agent) : null);
    const [savedDraft, setSavedDraft] = React.useState<AiAgentDraft | null>(() => agent ? cloneAiAgentDraft(agent) : null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        const nextAgent = findAiAgent(data, id);
        const nextDraft = nextAgent ? cloneAiAgentDraft(nextAgent) : null;
        setDraft(nextDraft);
        setSavedDraft(nextDraft);
    }, [id]);

    if (!agent || !draft || !savedDraft) return <Text style={styles.missing}>{isZh ? '没有找到这个 Agent' : 'Agent not found'}</Text>;

    const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
    const canSave = Boolean(dirty && draft.name.trim() && draft.description.trim());

    const save = async () => {
        if (!draft.name.trim() || !draft.description.trim()) {
            Modal.alert(isZh ? '请完善基本信息' : 'Complete the profile', isZh ? '名称和描述不能为空。' : 'Name and description are required.');
            return;
        }
        if (saving) return;
        setSaving(true);
        try {
            await saveManagedAiAgent(applyAiAgentDraft(agent, draft));
            setSavedDraft(cloneDraft(draft));
            router.back();
        } catch (error) {
            Modal.alert(isZh ? '无法保存 Agent' : 'Could not save agent', error instanceof Error ? error.message : undefined);
            setSaving(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerTitle: isZh ? '编辑 Agent' : 'Edit agent' }} />
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <AgentDefinitionForm draft={draft} onChange={setDraft} isZh={isZh} avatarId={agent.id} />
            </ScrollView>
            <View style={styles.footer}>
                <View style={styles.footerContent}>
                    <RoundButton
                        size="large"
                        title={saving ? (isZh ? '正在保存…' : 'Saving…') : (isZh ? '保存修改' : 'Save changes')}
                        disabled={!canSave || saving}
                        style={styles.footerButton}
                        onPress={save}
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

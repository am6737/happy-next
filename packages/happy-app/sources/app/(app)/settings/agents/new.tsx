import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { RoundButton } from '@/components/RoundButton';
import { AgentDefinitionForm } from '@/features/aiTeams/AgentDefinitionForm';
import { createEmptyAiAgentDraft } from '@/features/aiTeams/agentDefinition';
import { createManagedAiAgent, saveManagedAiTeam, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiTeam } from '@/features/aiTeams/types';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    scrollContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: { xs: 24, md: 34 }, paddingBottom: 140 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 82, borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface, paddingHorizontal: { xs: 16, md: 24 }, paddingVertical: 14, alignItems: 'center' },
    footerContent: { width: '100%', maxWidth: 704, flexDirection: 'row', justifyContent: 'flex-end' },
    footerButton: { minWidth: { xs: '100%', md: 190 } },
}));

export default function CreateAiAgentPage() {
    const router = useRouter();
    const { teamId } = useLocalSearchParams<{ teamId?: string }>();
    const data = useManagedAiTeamData();
    const styles = stylesheet;
    const isZh = getCurrentLanguage().startsWith('zh');
    const [draft, setDraft] = React.useState(createEmptyAiAgentDraft);
    const [creating, setCreating] = React.useState(false);
    const canCreate = Boolean(draft.name.trim() && draft.description.trim());

    const create = async () => {
        if (!canCreate || creating) return;
        setCreating(true);
        try {
            const agent = await createManagedAiAgent({
                ...draft,
                name: draft.name.trim(),
                description: draft.description.trim(),
            }, isZh);
            const sourceTeam = teamId ? findAiTeam(data, teamId) : undefined;
            if (sourceTeam) await saveManagedAiTeam({ ...sourceTeam, memberIds: Array.from(new Set([...sourceTeam.memberIds, agent.id])) });
            router.replace(`/settings/agents/${agent.id}` as never);
        } catch (error) {
            Modal.alert(isZh ? '无法创建 Agent' : 'Could not create agent', error instanceof Error ? error.message : undefined);
            setCreating(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerTitle: isZh ? '创建 Agent' : 'Create an agent' }} />
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <AgentDefinitionForm draft={draft} onChange={setDraft} isZh={isZh} avatarId="new-agent" />
            </ScrollView>
            <View style={styles.footer}>
                <View style={styles.footerContent}>
                    <RoundButton
                        size="large"
                        title={creating ? (isZh ? '正在创建…' : 'Creating…') : (isZh ? '创建并打开 Agent' : 'Create & open agent')}
                        disabled={!canCreate || creating}
                        style={styles.footerButton}
                        onPress={create}
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

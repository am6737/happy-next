import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { TeamDefinitionForm, type AiTeamDraft } from '@/features/aiTeams/TeamDefinitionForm';
import { createManagedAiTeam, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: 22, paddingBottom: 70 },
    save: { paddingHorizontal: 10, paddingVertical: 7 },
    saveText: { color: theme.colors.textLink, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.35 },
}));

export default function NewAiTeamPage() {
    const router = useRouter();
    const data = useManagedAiTeamData();
    const isZh = getCurrentLanguage().startsWith('zh');
    const firstAgentId = data.agents[0]?.id ?? '';
    const [draft, setDraft] = React.useState<AiTeamDraft>({ name: '', description: '', leaderId: firstAgentId, memberIds: firstAgentId ? [firstAgentId] : [], instructions: '' });
    const valid = draft.name.trim().length > 0 && draft.memberIds.length > 0 && draft.memberIds.includes(draft.leaderId);
    const save = () => {
        if (!valid) return;
        const team = createManagedAiTeam({ ...draft, name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions.trim(), emoji: '✨', currentGoal: '', progress: 0 });
        router.replace(`/settings/teams/${team.id}` as never);
    };

    return (
        <View style={stylesheet.screen}>
            <Stack.Screen options={{ headerTitle: isZh ? '创建团队' : 'Create team', headerRight: () => <Pressable style={[stylesheet.save, !valid && stylesheet.disabled]} disabled={!valid} onPress={save}><Text style={stylesheet.saveText}>{isZh ? '创建' : 'Create'}</Text></Pressable> }} />
            <ScrollView contentContainerStyle={stylesheet.content} keyboardShouldPersistTaps="handled">
                <TeamDefinitionForm draft={draft} agents={data.agents} onChange={setDraft} isZh={isZh} />
            </ScrollView>
        </View>
    );
}

import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { TeamDefinitionForm, type AiTeamDraft } from '@/features/aiTeams/TeamDefinitionForm';
import { findAiTeam } from '@/features/aiTeams/mockData';
import { deleteManagedAiTeam, saveManagedAiTeam, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: 22, paddingBottom: 70 },
    missing: { color: theme.colors.text, padding: 24 },
    save: { paddingHorizontal: 10, paddingVertical: 7 },
    saveText: { color: theme.colors.textLink, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.35 },
    danger: { marginTop: 32, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.textDestructive, alignItems: 'center', justifyContent: 'center' },
    dangerText: { color: theme.colors.textDestructive, fontSize: 15, fontWeight: '600' },
}));

export default function EditAiTeamPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const data = useManagedAiTeamData();
    const team = findAiTeam(data, id);
    const isZh = getCurrentLanguage().startsWith('zh');
    const [draft, setDraft] = React.useState<AiTeamDraft | null>(team ? {
        name: team.name,
        description: team.description,
        leaderId: team.leaderId,
        memberIds: [...team.memberIds],
        instructions: team.instructions,
    } : null);

    React.useEffect(() => {
        if (team) setDraft({ name: team.name, description: team.description, leaderId: team.leaderId, memberIds: [...team.memberIds], instructions: team.instructions });
    }, [team?.id]);

    if (!team || !draft) return <View style={stylesheet.screen}><Stack.Screen options={{ headerTitle: isZh ? '团队设置' : 'Team settings' }} /><Text style={stylesheet.missing}>{isZh ? '未找到团队' : 'Team not found'}</Text></View>;
    const valid = draft.name.trim().length > 0 && draft.memberIds.length > 0 && draft.memberIds.includes(draft.leaderId);
    const remove = async () => {
        const confirmed = await Modal.confirm(isZh ? '删除团队？' : 'Delete team?', isZh ? `“${team.name}”的本地团队配置和群聊入口将被移除。` : `The local team configuration and group entry for “${team.name}” will be removed.`, { confirmText: isZh ? '删除' : 'Delete', destructive: true });
        if (!confirmed) return;
        deleteManagedAiTeam(team.id);
        router.replace('/settings/teams' as never);
    };
    const save = () => {
        if (!valid) return;
        saveManagedAiTeam({ ...team, ...draft, name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions.trim() });
        router.back();
    };

    return (
        <View style={stylesheet.screen}>
            <Stack.Screen options={{ headerTitle: isZh ? '团队设置' : 'Team settings', headerRight: () => <Pressable style={[stylesheet.save, !valid && stylesheet.disabled]} disabled={!valid} onPress={save}><Text style={stylesheet.saveText}>{isZh ? '保存' : 'Save'}</Text></Pressable> }} />
            <ScrollView contentContainerStyle={stylesheet.content} keyboardShouldPersistTaps="handled">
                <TeamDefinitionForm draft={draft} agents={data.agents} onChange={setDraft} isZh={isZh} />
                <Pressable style={stylesheet.danger} onPress={remove}><Text style={stylesheet.dangerText}>{isZh ? '删除团队' : 'Delete team'}</Text></Pressable>
            </ScrollView>
        </View>
    );
}

import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { AiIdentityAvatar } from './components';
import type { AiAgent, AiTeam } from './types';

export type AiTeamDraft = Pick<AiTeam, 'name' | 'description' | 'leaderId' | 'memberIds' | 'instructions'>;

const stylesheet = StyleSheet.create((theme) => ({
    section: { marginBottom: { xs: 26, md: 34 } },
    title: { color: theme.colors.text, fontSize: { xs: 18, md: 20 }, fontWeight: '700', marginBottom: 13 },
    card: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 17, overflow: 'hidden', backgroundColor: theme.colors.surface },
    field: { paddingHorizontal: { xs: 17, md: 23 }, paddingVertical: { xs: 17, md: 21 } },
    divider: { borderTopWidth: 1, borderTopColor: theme.colors.divider },
    label: { color: theme.colors.text, fontSize: 15, fontWeight: '600', marginBottom: 10 },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, paddingHorizontal: 14, color: theme.colors.input.text, backgroundColor: theme.colors.surface, fontSize: 15 },
    textArea: { minHeight: 96, paddingTop: 13, paddingBottom: 13, textAlignVertical: 'top', lineHeight: 22 },
    memberRow: { minHeight: 68, paddingHorizontal: { xs: 15, md: 19 }, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    memberPressed: { backgroundColor: theme.colors.surfaceHigh },
    memberBody: { flex: 1, minWidth: 0 },
    memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    memberName: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    memberRole: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 3 },
    leaderText: { color: theme.colors.textLink, fontSize: 11, fontWeight: '700' },
    check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' },
    checkSelected: { borderColor: theme.colors.text, backgroundColor: theme.colors.text },
    leaderButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surfaceHigh },
    leaderButtonText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
    hint: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 9 },
}));

export function TeamDefinitionForm({ draft, agents, onChange, isZh }: {
    draft: AiTeamDraft;
    agents: AiAgent[];
    onChange: (draft: AiTeamDraft) => void;
    isZh: boolean;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const toggleMember = (agentId: string) => {
        const selected = draft.memberIds.includes(agentId);
        if (selected && draft.memberIds.length === 1) return;
        const memberIds = selected ? draft.memberIds.filter((id) => id !== agentId) : [...draft.memberIds, agentId];
        const leaderId = memberIds.includes(draft.leaderId) ? draft.leaderId : memberIds[0] ?? '';
        onChange({ ...draft, memberIds, leaderId });
    };

    return (
        <>
            <View style={styles.section}>
                <Text style={styles.title}>{isZh ? '团队信息' : 'Team details'}</Text>
                <View style={styles.card}>
                    <View style={styles.field}>
                        <Text style={styles.label}>{isZh ? '团队名称' : 'Team name'}</Text>
                        <TextInput value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} placeholder={isZh ? '例如：产品研发组' : 'e.g. Product team'} placeholderTextColor={theme.colors.input.placeholder} style={styles.input} maxLength={60} />
                    </View>
                    <View style={[styles.field, styles.divider]}>
                        <Text style={styles.label}>{isZh ? '团队描述' : 'Description'}</Text>
                        <TextInput value={draft.description} onChangeText={(description) => onChange({ ...draft, description })} placeholder={isZh ? '说明这支团队负责什么' : 'What is this team responsible for?'} placeholderTextColor={theme.colors.input.placeholder} style={[styles.input, styles.textArea]} multiline maxLength={240} />
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.title}>{isZh ? '成员与 Leader' : 'Members and leader'}</Text>
                <View style={styles.card}>
                    {agents.map((agent, index) => {
                        const selected = draft.memberIds.includes(agent.id);
                        const isLeader = draft.leaderId === agent.id;
                        return (
                            <View key={agent.id} style={[styles.memberRow, index > 0 && styles.divider]}>
                                <AiIdentityAvatar id={agent.id} name={agent.name} size={36} />
                                <View style={styles.memberBody}>
                                    <View style={styles.memberNameRow}>
                                        <Text style={styles.memberName}>{agent.name}</Text>
                                        {isLeader ? <Text style={styles.leaderText}>LEADER</Text> : null}
                                    </View>
                                    <Text style={styles.memberRole}>{agent.role}</Text>
                                </View>
                                {selected && !isLeader ? (
                                    <Pressable style={({ pressed }) => [styles.leaderButton, pressed && styles.memberPressed]} onPress={() => onChange({ ...draft, leaderId: agent.id })}>
                                        <Text style={styles.leaderButtonText}>{isZh ? '设为 Leader' : 'Make leader'}</Text>
                                    </Pressable>
                                ) : null}
                                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleMember(agent.id)}>
                                    <View style={[styles.check, selected && styles.checkSelected]}>
                                        {selected ? <Ionicons name="checkmark" size={15} color={theme.colors.button.primary.tint} /> : null}
                                    </View>
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
                <Text style={styles.hint}>{isZh ? 'Leader 必须是团队成员，负责拆解目标、协调工作和汇总结果。' : 'The leader must be a member and coordinates goals, work, and results.'}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.title}>{isZh ? '协作说明' : 'Collaboration instructions'}</Text>
                <View style={styles.card}>
                    <View style={styles.field}>
                        <TextInput value={draft.instructions} onChangeText={(instructions) => onChange({ ...draft, instructions })} placeholder={isZh ? '写下团队的工作方式、审批边界和交付要求…' : 'Describe workflow, approval boundaries, and delivery expectations…'} placeholderTextColor={theme.colors.input.placeholder} style={[styles.input, styles.textArea]} multiline />
                    </View>
                </View>
            </View>
        </>
    );
}

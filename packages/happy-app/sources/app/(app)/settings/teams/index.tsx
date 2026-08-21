import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { IconButton } from '@/components/IconButton';
import { AiIdentityAvatar, AiTeamAvatar } from '@/features/aiTeams/components';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiAgent } from '@/features/aiTeams/types';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 920, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: { xs: 18, md: 24 }, paddingBottom: 80 },
    toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: { xs: 24, md: 32 }, gap: 12 },
    filterButton: { minHeight: 42, paddingHorizontal: 15, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surface },
    filterText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    toolbarActions: { flexDirection: 'row', gap: 8 },
    iconButton: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' },
    tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 10 },
    teamHeader: { flex: 1, color: theme.colors.textSecondary, fontSize: 14 },
    leaderHeader: { width: 210, color: theme.colors.textSecondary, fontSize: 14 },
    membersHeader: { width: 80, color: theme.colors.textSecondary, fontSize: 14, textAlign: 'right' },
    row: { minHeight: { xs: 82, md: 92 }, paddingHorizontal: { xs: 10, md: 18 }, paddingVertical: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface },
    rowPressed: { backgroundColor: theme.colors.surfaceHigh },
    teamCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
    teamText: { flex: 1, minWidth: 0 },
    teamName: { color: theme.colors.text, fontSize: { xs: 16, md: 17 }, fontWeight: '700' },
    description: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
    leaderCell: { width: 210, flexDirection: 'row', alignItems: 'center', gap: 10 },
    leaderName: { color: theme.colors.text, fontSize: 15, fontWeight: '500' },
    leaderRole: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
    membersCell: { width: 80, color: theme.colors.textSecondary, fontSize: 15, textAlign: 'right' },
    mobileMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
    mobileMetaText: { color: theme.colors.textSecondary, fontSize: 12 },
    separator: { height: 1, backgroundColor: theme.colors.divider, marginLeft: { xs: 72, md: 80 } },
    empty: { alignItems: 'center', paddingVertical: 96, paddingHorizontal: 24 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHigh, marginBottom: 18 },
    emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '600' },
    emptyText: { color: theme.colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 7, maxWidth: 360 },
}));

export default function AiTeamsSettingsPage() {
    const router = useRouter();
    const { theme, rt } = useUnistyles();
    const styles = stylesheet;
    const data = useManagedAiTeamData();
    const isZh = getCurrentLanguage().startsWith('zh');
    const isCompact = rt.screen.width < 640;
    const createTeam = () => router.push('/settings/teams/new' as never);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{
                headerTitle: `${isZh ? 'AI 团队' : 'AI teams'}  ${data.teams.length}`,
                headerRight: () => (
                    <IconButton
                        size="normal"
                        display="plain"
                        accessibilityLabel={isZh ? '创建 AI 团队' : 'Create AI team'}
                        icon={<Ionicons name="add" size={25} color={theme.colors.header.tint} />}
                        onPress={createTeam}
                    />
                ),
            }} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {data.teams.length ? (
                    <View>
                        {!isCompact && Platform.OS === 'web' ? (
                            <View style={styles.tableHeader}>
                                <Text style={styles.teamHeader}>{isZh ? '团队' : 'Team'}</Text>
                                <Text style={styles.leaderHeader}>{isZh ? '负责人' : 'Lead'}</Text>
                                <Text style={styles.membersHeader}>{isZh ? '成员' : 'Members'}</Text>
                            </View>
                        ) : null}
                        {data.teams.map((team, index) => {
                            const leader = findAiAgent(data, team.leaderId);
                            return (
                                <React.Fragment key={team.id}>
                                    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => router.push(`/settings/teams/${team.id}` as never)}>
                                        <View style={styles.teamCell}>
                                            <AiTeamAvatar size={48} />
                                            <View style={styles.teamText}>
                                                <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
                                                {!isCompact ? <Text style={styles.description} numberOfLines={1}>{team.description}</Text> : null}
                                                {isCompact ? (
                                                    <View style={styles.mobileMeta}>
                                                        <Text style={styles.mobileMetaText}>{leader?.name ?? '-'}</Text>
                                                        <Text style={styles.mobileMetaText}>·</Text>
                                                        <Text style={styles.mobileMetaText}>{isZh ? `${team.memberIds.length} 名成员` : `${team.memberIds.length} members`}</Text>
                                                    </View>
                                                ) : null}
                                            </View>
                                        </View>
                                        {!isCompact ? (
                                            <View style={styles.leaderCell}>
                                                {leader ? <AiIdentityAvatar id={leader.id} name={leader.emoji || leader.name} size={34} /> : null}
                                                <View><Text style={styles.leaderName}>{leader?.name ?? '-'}</Text><Text style={styles.leaderRole}>{isZh ? '团队负责人' : 'Team lead'}</Text></View>
                                            </View>
                                        ) : null}
                                        {!isCompact ? <Text style={styles.membersCell}>{team.memberIds.length}</Text> : <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />}
                                    </Pressable>
                                    {index < data.teams.length - 1 ? <View style={styles.separator} /> : null}
                                </React.Fragment>
                            );
                        })}
                    </View>
                ) : (
                    <View style={styles.empty}>
                        <View style={styles.emptyIcon}><Ionicons name="people-outline" size={30} color={theme.colors.textSecondary} /></View>
                        <Text style={styles.emptyTitle}>{isZh ? '还没有 AI 团队' : 'No AI teams yet'}</Text>
                        <Text style={styles.emptyText}>{isZh ? '把不同职责的 Agent 组织成团队，共同推进一项目标。' : 'Organize agents with different roles around a shared goal.'}</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { AiAgentPresencePill, AiIdentityAvatar, AiTeamAvatar } from '@/features/aiTeams/components';
import { ensureManagedTeamConversation, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiAgent, findAiTeam, getAiWorkSourcePath } from '@/features/aiTeams/mockData';
import { deriveAiAgentPresence } from '@/features/aiTeams/agentPresence';
import { getCurrentLanguage } from '@/text';

type DetailTab = 'members' | 'instructions';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 980, alignSelf: 'center', paddingHorizontal: { xs: 14, md: 28 }, paddingTop: { xs: 18, md: 26 }, paddingBottom: { xs: 54, md: 80 } },
    breadcrumb: { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 20, display: { xs: 'none', md: 'flex' } },
    overview: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 14, md: 18 }, overflow: 'hidden', marginBottom: { xs: 22, md: 28 } },
    overviewHero: { padding: { xs: 18, md: 28 }, flexDirection: 'row', alignItems: 'flex-start', gap: { xs: 14, md: 20 } },
    overviewBody: { flex: 1, minWidth: 0 },
    name: { color: theme.colors.text, fontSize: { xs: 23, md: 28 }, lineHeight: { xs: 29, md: 35 }, fontWeight: '700' },
    description: { color: theme.colors.textSecondary, fontSize: { xs: 14, md: 15 }, lineHeight: { xs: 21, md: 23 }, marginTop: 6, maxWidth: 680 },
    overviewDivider: { height: 1, backgroundColor: theme.colors.divider },
    currentWork: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 14, md: 18 }, marginBottom: { xs: 22, md: 28 }, overflow: 'hidden' },
    currentWorkHeader: { paddingHorizontal: { xs: 17, md: 22 }, paddingTop: { xs: 16, md: 19 }, paddingBottom: 13 },
    currentWorkTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    currentWorkTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
    currentWorkProgress: { color: theme.colors.textSecondary, fontSize: 13 },
    currentGoal: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 5 },
    progressTrack: { height: 3, backgroundColor: theme.colors.surfaceHighest, marginTop: 13, borderRadius: 2, overflow: 'hidden' },
    progressFill: { height: 3, backgroundColor: theme.colors.textLink, borderRadius: 2 },
    workRows: { borderTopWidth: 1, borderTopColor: theme.colors.divider },
    workRow: { minHeight: 54, paddingHorizontal: { xs: 17, md: 22 }, flexDirection: 'row', alignItems: 'center', gap: 10 },
    workRowPressed: { backgroundColor: theme.colors.surfaceHigh },
    workDot: { width: 7, height: 7, borderRadius: 4 },
    workText: { flex: 1, minWidth: 0 },
    workName: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    workMeta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
    details: { paddingHorizontal: { xs: 18, md: 28 }, paddingVertical: { xs: 16, md: 20 } },
    detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 17 },
    detailItem: { width: '50%', minWidth: 130, paddingRight: 12 },
    detailLabel: { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 6 },
    detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    detailValue: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    workspace: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 14, md: 18 }, overflow: 'hidden' },
    tabs: { minHeight: 62, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: { xs: 12, md: 20 }, flexDirection: 'row', alignItems: 'stretch', gap: { xs: 4, md: 12 } },
    tab: { minWidth: 126, paddingHorizontal: { xs: 10, md: 14 }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: theme.colors.text },
    tabText: { color: theme.colors.textSecondary, fontSize: 15, fontWeight: '600' },
    tabTextActive: { color: theme.colors.text },
    workspaceBody: { padding: { xs: 16, md: 24 }, minHeight: 260 },
    sectionHeader: { flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'center' }, justifyContent: 'space-between', gap: 14, marginBottom: 18 },
    sectionTitle: { color: theme.colors.text, fontSize: { xs: 19, md: 21 }, fontWeight: '700' },
    sectionSubtitle: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 9 },
    secondaryButton: { minHeight: 42, paddingHorizontal: { xs: 10, md: 15 }, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.divider, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    primaryButton: { minHeight: 42, paddingHorizontal: { xs: 10, md: 15 }, borderRadius: 11, backgroundColor: theme.colors.button.primary.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    actionGrow: { flex: 1 },
    secondaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    primaryButtonText: { color: theme.colors.button.primary.tint, fontSize: 14, fontWeight: '600' },
    memberList: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 14, overflow: 'hidden' },
    memberRow: { paddingHorizontal: { xs: 14, md: 18 }, paddingVertical: 15, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 13 },
    memberPressed: { backgroundColor: theme.colors.surfaceHigh },
    memberBody: { flex: 1, minWidth: 0 },
    memberNameLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
    memberName: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
    leaderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FFF3C4' },
    leaderBadgeText: { color: '#A25A00', fontSize: 11, fontWeight: '700' },
    memberRole: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
    memberStatus: { display: { xs: 'none', md: 'flex' } },
    memberDivider: { height: 1, backgroundColor: theme.colors.divider, marginLeft: { xs: 75, md: 81 } },
    instructionsTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginBottom: 10 },
    instructionsText: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 24, maxWidth: 760 },
    archiveButton: { width: { xs: 42, md: 'auto' }, height: 42, paddingHorizontal: { xs: 0, md: 12 }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    archiveText: { color: theme.colors.textDestructive, fontSize: 15, fontWeight: '600' },
    missing: { padding: 24, textAlign: 'center', color: theme.colors.textSecondary },
}));

export default function AiTeamDetailPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme, rt } = useUnistyles();
    const styles = stylesheet;
    const data = useManagedAiTeamData();
    const isZh = getCurrentLanguage().startsWith('zh');
    const isCompact = rt.screen.width < 500;
    const [tab, setTab] = React.useState<DetailTab>('members');
    const team = findAiTeam(data, id);

    if (!team) return <Text style={styles.missing}>{isZh ? '没有找到这个团队' : 'Team not found'}</Text>;

    const leader = findAiAgent(data, team.leaderId);
    const members = team.memberIds.map((memberId) => findAiAgent(data, memberId)).filter((member) => member !== undefined);

    const editTeam = () => router.push(`/settings/teams/edit/${team.id}` as never);
    const openGroupChat = () => { const conversation = ensureManagedTeamConversation(team, isZh); router.push(`/inbox/ai/${conversation.id}` as never); };
    const teamWork = data.workItems.filter((work) => work.teamId === team.id);


    return (
        <View style={styles.screen}>
            <Stack.Screen options={{
                headerTitle: team.name,
                headerRight: () => (
                    <Pressable accessibilityRole="button" accessibilityLabel={isZh ? '团队设置' : 'Team settings'} style={styles.archiveButton} onPress={editTeam}>
                        <Ionicons name="settings-outline" size={20} color={theme.colors.text} />
                        {!isCompact ? <Text style={[styles.archiveText, { color: theme.colors.text }]}>{isZh ? '设置' : 'Settings'}</Text> : null}
                    </Pressable>
                ),
            }} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <Text style={styles.breadcrumb}>{isZh ? 'AI 团队' : 'AI teams'}  /  {team.name}</Text>

                <View style={styles.overview}>
                    <View style={styles.overviewHero}>
                        <AiTeamAvatar size={72} />
                        <View style={styles.overviewBody}>
                            <Text style={styles.name}>{team.name}</Text>
                            <Text style={styles.description}>{team.description}</Text>
                        </View>
                    </View>
                    <View style={styles.overviewDivider} />
                    <View style={styles.details}>
                        <View style={styles.detailsGrid}>
                            <View style={styles.detailItem}>
                                <Text style={styles.detailLabel}>{isZh ? '负责人' : 'Lead'}</Text>
                                <Pressable disabled={!leader} style={styles.detailValueRow} onPress={() => leader && router.push(`/settings/agents/${leader.id}` as never)}>
                                    {leader ? <AiIdentityAvatar id={leader.id} name={leader.emoji || leader.name} size={24} /> : null}
                                    <Text style={styles.detailValue} numberOfLines={1}>{leader?.name ?? '-'}</Text>
                                </Pressable>
                            </View>
                            <View style={styles.detailItem}><Text style={styles.detailLabel}>{isZh ? '成员' : 'Members'}</Text><Text style={styles.detailValue}>{members.length}</Text></View>
                        </View>
                    </View>
                </View>

                <View style={[styles.actions, { marginBottom: 22 }]}>
                    <Pressable style={[styles.primaryButton, styles.actionGrow]} onPress={openGroupChat}><Ionicons name="chatbubbles-outline" size={18} color={theme.colors.button.primary.tint} /><Text style={styles.primaryButtonText}>{isZh ? '打开群聊' : 'Open group chat'}</Text></Pressable>
                    <Pressable style={[styles.secondaryButton, styles.actionGrow]} onPress={editTeam}><Ionicons name="settings-outline" size={18} color={theme.colors.text} /><Text style={styles.secondaryButtonText}>{isZh ? '团队设置' : 'Team settings'}</Text></Pressable>
                </View>

                {team.currentGoal || teamWork.length > 0 ? (
                    <View style={styles.currentWork}>
                        <View style={styles.currentWorkHeader}>
                            <View style={styles.currentWorkTitleRow}>
                                <Text style={styles.currentWorkTitle}>{isZh ? '当前工作' : 'Current work'}</Text>
                                <Text style={styles.currentWorkProgress}>{team.progress}%</Text>
                            </View>
                            {team.currentGoal ? <Text style={styles.currentGoal}>{team.currentGoal}</Text> : null}
                            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${team.progress}%` }]} /></View>
                        </View>
                        {teamWork.length > 0 ? (
                            <View style={styles.workRows}>
                                {teamWork.map((work) => {
                                    const assignee = findAiAgent(data, work.assigneeId);
                                    const dotColor = work.status === 'done' ? theme.colors.success : work.status === 'blocked' ? theme.colors.textDestructive : work.status === 'working' || work.status === 'review' ? theme.colors.textLink : theme.colors.textSecondary;
                                    const path = getAiWorkSourcePath(work);
                                    return (
                                        <Pressable key={work.id} style={({ pressed }) => [styles.workRow, pressed && styles.workRowPressed]} onPress={() => path && router.push(path as never)}>
                                            <View style={[styles.workDot, { backgroundColor: dotColor }]} />
                                            <View style={styles.workText}>
                                                <Text style={styles.workName} numberOfLines={1}>{work.title}</Text>
                                                <Text style={styles.workMeta}>{assignee?.name ?? '-'} · {work.statusLabel}</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ) : null}
                    </View>
                ) : null}

                <View style={styles.workspace}>
                    <View style={styles.tabs}>
                        <Pressable style={[styles.tab, tab === 'members' && styles.tabActive]} onPress={() => setTab('members')}>
                            <Ionicons name="people-outline" size={19} color={tab === 'members' ? theme.colors.text : theme.colors.textSecondary} />
                            <Text style={[styles.tabText, tab === 'members' && styles.tabTextActive]}>{isZh ? '成员' : 'Members'}</Text>
                        </Pressable>
                        <Pressable style={[styles.tab, tab === 'instructions' && styles.tabActive]} onPress={() => setTab('instructions')}>
                            <Ionicons name="document-text-outline" size={19} color={tab === 'instructions' ? theme.colors.text : theme.colors.textSecondary} />
                            <Text style={[styles.tabText, tab === 'instructions' && styles.tabTextActive]}>{isZh ? '协作说明' : 'Instructions'}</Text>
                        </Pressable>
                    </View>

                    <View style={styles.workspaceBody}>
                        {tab === 'members' ? (
                            <>
                                <View style={styles.sectionHeader}>
                                    <View><Text style={styles.sectionTitle}>{isZh ? '团队成员' : 'Members'}</Text><Text style={styles.sectionSubtitle}>{isZh ? `${members.length} 名 Agent 参与协作` : `${members.length} agents in this team`}</Text></View>
                                    <View style={styles.actions}>
                                        <Pressable style={[styles.secondaryButton, isCompact && styles.actionGrow]} onPress={() => router.push(`/settings/agents/new?teamId=${encodeURIComponent(team.id)}` as never)}><Ionicons name="add" size={19} color={theme.colors.text} /><Text style={styles.secondaryButtonText}>{isZh ? '创建 Agent' : 'Create agent'}</Text></Pressable>
                                        <Pressable style={[styles.primaryButton, isCompact && styles.actionGrow]} onPress={editTeam}><Ionicons name="person-add-outline" size={18} color={theme.colors.button.primary.tint} /><Text style={styles.primaryButtonText}>{isZh ? '添加成员' : 'Add member'}</Text></Pressable>
                                    </View>
                                </View>
                                <View style={styles.memberList}>
                                    {members.map((member, index) => {
                                        const presence = deriveAiAgentPresence(member, data.workItems);
                                        return (
                                        <React.Fragment key={member.id}>
                                            <Pressable style={({ pressed }) => [styles.memberRow, pressed && styles.memberPressed]} onPress={() => router.push(`/settings/agents/${member.id}` as never)}>
                                                <AiIdentityAvatar id={member.id} name={member.emoji || member.name} size={48} />
                                                <View style={styles.memberBody}>
                                                    <View style={styles.memberNameLine}>
                                                        <Text style={styles.memberName}>{member.name}</Text>
                                                        {member.id === team.leaderId ? <View style={styles.leaderBadge}><Ionicons name="ribbon-outline" size={13} color="#A25A00" /><Text style={styles.leaderBadgeText}>{isZh ? '负责人' : 'Lead'}</Text></View> : null}
                                                    </View>
                                                    <Text style={styles.memberRole} numberOfLines={1}>{member.role}</Text>
                                                </View>
                                                <View style={styles.memberStatus}><AiAgentPresencePill presence={presence} isZh={isZh} /></View>
                                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                                            </Pressable>
                                            {index < members.length - 1 ? <View style={styles.memberDivider} /> : null}
                                        </React.Fragment>
                                        );
                                    })}
                                </View>
                            </>
                        ) : (
                            <View>
                                <Text style={styles.instructionsTitle}>{isZh ? '团队如何协作' : 'How this team works'}</Text>
                                <Text style={styles.instructionsText}>{team.instructions}</Text>
                            </View>
                        )}
                    </View>
                </View>

            </ScrollView>
        </View>
    );
}

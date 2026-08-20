import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { AiAgentPresenceDot, AiIdentityAvatar, AiTeamAvatar } from '@/features/aiTeams/components';
import { RoundButton } from '@/components/RoundButton';
import { IconButton } from '@/components/IconButton';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import {
    deleteManagedAiAgent,
    duplicateManagedAiAgent,
    ensureManagedAgentConversation,
    saveManagedAiAgent,
    useManagedAiTeamData,
} from '@/features/aiTeams/agentStore';
import {
    findAiAgent,
    findAiTeam,
    findAiWorkItem,
    getAiWorkSourcePath,
    type AiExecutionEventKind,
    type AiWorkItem,
    type AiWorkStatus,
} from '@/features/aiTeams/mockData';
import { deriveAiAgentPresence, getAiAgentPresenceLabel } from '@/features/aiTeams/agentPresence';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 920, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: { xs: 18, md: 26 }, paddingBottom: { xs: 48, md: 80 } },
    hero: { marginBottom: { xs: 30, md: 42 } },
    breadcrumb: { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 24, display: { xs: 'none', md: 'flex' } },
    heroMain: { flexDirection: 'row', alignItems: 'flex-start', gap: { xs: 14, md: 22 } },
    heroBody: { flex: 1, minWidth: 0 },
    titleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
    name: { color: theme.colors.text, fontSize: { xs: 24, md: 30 }, lineHeight: { xs: 30, md: 37 }, fontWeight: '700' },
    statusMuted: { color: theme.colors.textSecondary, fontSize: 15 },
    description: { color: theme.colors.textSecondary, fontSize: { xs: 15, md: 16 }, lineHeight: { xs: 22, md: 25 }, marginTop: { xs: 7, md: 10 }, maxWidth: 690 },
    actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: { xs: 8, md: 10 }, marginTop: { xs: 18, md: 22 } },
    actionGrow: { flex: 1, justifyContent: 'center' },
    section: { marginBottom: { xs: 30, md: 40 } },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: { xs: 12, md: 15 } },
    sectionTitle: { color: theme.colors.text, fontSize: { xs: 18, md: 20 }, fontWeight: '700' },
    sectionAction: { color: theme.colors.textLink, fontSize: 14, fontWeight: '600' },
    card: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 15, md: 18 }, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    currentCard: { padding: { xs: 16, md: 20 } },
    currentTop: { flexDirection: 'row', alignItems: 'flex-start', gap: { xs: 10, md: 13 } },
    currentIcon: { width: { xs: 36, md: 40 }, height: { xs: 36, md: 40 }, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHigh },
    currentBody: { flex: 1, minWidth: 0 },
    currentTitle: { color: theme.colors.text, fontSize: { xs: 16, md: 17 }, fontWeight: '700' },
    currentSummary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 },
    currentMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    metaChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surfaceHigh },
    metaChipText: { color: theme.colors.textSecondary, fontSize: 12 },
    activityRow: { minHeight: { xs: 70, md: 76 }, paddingHorizontal: { xs: 14, md: 18 }, paddingVertical: { xs: 12, md: 14 }, flexDirection: 'row', alignItems: 'flex-start', gap: { xs: 9, md: 13 } },
    activityPressed: { backgroundColor: theme.colors.surfaceHigh },
    activityIcon: { width: { xs: 26, md: 30 }, paddingTop: 1, alignItems: 'center' },
    activityBody: { flex: 1, minWidth: 0 },
    activityTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    activityBodyText: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
    activityTime: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 6 },
    divider: { height: 1, backgroundColor: theme.colors.divider, marginLeft: { xs: 49, md: 61 } },
    empty: { paddingVertical: 24, paddingHorizontal: 20 },
    emptyText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
    definitionCard: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 15, md: 18 }, padding: { xs: 16, md: 22 } },
    definitionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: { xs: 16, md: 20 } },
    definitionTitle: { color: theme.colors.text, fontSize: { xs: 17, md: 18 }, fontWeight: '700' },
    instructionLabel: { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 7 },
    instructionText: { color: theme.colors.text, fontSize: 15, lineHeight: 23 },
    definitionDivider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: { xs: 16, md: 20 } },
    definitionRows: { gap: { xs: 12, md: 14 } },
    definitionRow: { flexDirection: 'row', alignItems: 'center', gap: { xs: 8, md: 12 } },
    definitionIcon: { width: 24, alignItems: 'center' },
    definitionLabel: { width: { xs: 74, md: 92 }, color: theme.colors.textSecondary, fontSize: { xs: 13, md: 14 } },
    definitionValue: { flex: 1, color: theme.colors.text, fontSize: { xs: 13, md: 14 }, lineHeight: 20 },
    missing: { padding: 24, textAlign: 'center', color: theme.colors.textSecondary },
}));

function statusColor(status: AiWorkStatus, theme: ReturnType<typeof useUnistyles>['theme']) {
    if (status === 'done') return theme.colors.success;
    if (status === 'blocked') return theme.colors.textDestructive;
    if (status === 'review') return '#AF52DE';
    if (status === 'working') return theme.colors.textLink;
    return theme.colors.textSecondary;
}

function activityIcon(kind: AiExecutionEventKind): React.ComponentProps<typeof Ionicons>['name'] {
    if (kind === 'result') return 'checkmark-circle-outline';
    if (kind === 'tool') return 'hammer-outline';
    if (kind === 'comment') return 'chatbubble-outline';
    return 'pulse-outline';
}

export default function AiAgentDetailPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme, rt } = useUnistyles();
    const styles = stylesheet;
    const isZh = getCurrentLanguage().startsWith('zh');
    const isCompact = rt.screen.width < 500;
    const data = useManagedAiTeamData();
    const [menuVisible, setMenuVisible] = React.useState(false);
    const agent = findAiAgent(data, id);

    if (!agent) return <Text style={styles.missing}>{isZh ? '没有找到这个 Agent' : 'Agent not found'}</Text>;

    const enabled = agent.enabled !== false;
    const presence = deriveAiAgentPresence(agent, data.workItems);
    const currentWork = agent.currentWorkId ? findAiWorkItem(data, agent.currentWorkId) : data.workItems.find((item) => item.assigneeId === agent.id && item.status === 'working');
    const agentWork = data.workItems.filter((item) => item.assigneeId === agent.id);
    const teams = agent.teamIds.map((teamId) => findAiTeam(data, teamId)).filter((team) => team !== undefined);
    const conversation = data.conversations.find((item) => item.kind === 'direct' && item.agentId === agent.id);
    const engineLabels = { 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini' } as const;
    const permissionLabels = isZh
        ? { read_only: '只读', approval: '操作前确认', guarded_auto: '受控自动执行' }
        : { read_only: 'Read only', approval: 'Ask before actions', guarded_auto: 'Guarded autonomy' };
    const accessLabel = (agent.settings.visibility ?? 'private') === 'workspace'
        ? (isZh ? '整个工作区' : 'Entire workspace')
        : (isZh ? '仅自己' : 'Only me');

    const activity = data.executions
        .filter((execution) => execution.agentId === agent.id)
        .flatMap((execution) => execution.events.map((event) => ({ ...event, executionId: execution.id })))
        .slice(-5)
        .reverse();

    const openWork = (work: AiWorkItem) => {
        const path = getAiWorkSourcePath(work);
        if (path) router.push(path as never);
    };

    const openConversation = () => {
        const nextConversation = conversation ?? ensureManagedAgentConversation(agent, isZh);
        router.push(`/inbox/ai/${nextConversation.id}` as never);
    };

    const assignWork = () => router.push(`/settings/agents/assign/${agent.id}` as never);

    const toggleArchived = () => saveManagedAiAgent({ ...agent, enabled: !enabled });

    const duplicate = () => {
        const next = duplicateManagedAiAgent(agent, isZh);
        router.push(`/settings/agents/${next.id}` as never);
    };

    const remove = async () => {
        const confirmed = await Modal.confirm(
            isZh ? '删除 Agent？' : 'Delete agent?',
            isZh ? `“${agent.name}”的本地定义将被删除。` : `The local definition for “${agent.name}” will be deleted.`,
            { confirmText: isZh ? '删除' : 'Delete', destructive: true },
        );
        if (!confirmed) return;
        deleteManagedAiAgent(agent.id);
        router.back();
    };

    const menuItems: ActionMenuItem[] = [
        { label: isZh ? '编辑 Agent' : 'Edit agent', onPress: () => router.push(`/settings/agents/edit/${agent.id}` as never) },
        { label: enabled ? (isZh ? '归档 Agent' : 'Archive agent') : (isZh ? '恢复 Agent' : 'Restore agent'), onPress: toggleArchived },
        { label: isZh ? '复制 Agent' : 'Duplicate agent', onPress: duplicate },
        { label: isZh ? '删除 Agent' : 'Delete agent', destructive: true, onPress: remove },
    ];

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerTitle: agent.name }} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                    <Text style={styles.breadcrumb}>Agents / {agent.name}</Text>
                    <View style={styles.heroMain}>
                        <AiIdentityAvatar id={agent.id} name={agent.emoji || agent.name} size={isCompact ? 62 : 82} />
                        <View style={styles.heroBody}>
                            <View style={styles.titleLine}>
                                <Text style={styles.name}>{agent.name}</Text>
                                <AiAgentPresenceDot availability={presence.availability} size={9} />
                                <Text style={styles.statusMuted}>{getAiAgentPresenceLabel(presence, isZh)}</Text>
                            </View>
                            <Text style={styles.description}>{agent.description || agent.role}</Text>
                            {!isCompact ? (
                                <View style={styles.actions}>
                                    <RoundButton
                                            size="medium"
                                            display="outline"
                                            title={isZh ? '发消息' : 'Message'}
                                            icon={<Ionicons name="chatbubble-outline" size={18} color={theme.colors.text} />}
                                            onPress={openConversation}
                                        />
                                    <RoundButton
                                        size="medium"
                                        title={isZh ? '分配任务' : 'Assign work'}
                                        icon={<Ionicons name="add" size={19} color={theme.colors.button.primary.tint} />}
                                        onPress={assignWork}
                                    />
                                    <IconButton
                                        size="medium"
                                        display="outline"
                                        accessibilityLabel={isZh ? '更多操作' : 'More actions'}
                                        icon={<Ionicons name="ellipsis-horizontal" size={21} color={theme.colors.text} />}
                                        onPress={() => setMenuVisible(true)}
                                    />
                                </View>
                            ) : null}
                        </View>
                    </View>
                    {isCompact ? (
                        <View style={styles.actions}>
                            <RoundButton
                                    size="medium"
                                    display="outline"
                                    title={isZh ? '发消息' : 'Message'}
                                    icon={<Ionicons name="chatbubble-outline" size={18} color={theme.colors.text} />}
                                    style={styles.actionGrow}
                                    onPress={openConversation}
                                />
                            <RoundButton
                                size="medium"
                                title={isZh ? '分配任务' : 'Assign work'}
                                icon={<Ionicons name="add" size={19} color={theme.colors.button.primary.tint} />}
                                style={styles.actionGrow}
                                onPress={assignWork}
                            />
                            <IconButton
                                size="medium"
                                display="outline"
                                accessibilityLabel={isZh ? '更多操作' : 'More actions'}
                                icon={<Ionicons name="ellipsis-horizontal" size={21} color={theme.colors.text} />}
                                onPress={() => setMenuVisible(true)}
                            />
                        </View>
                    ) : null}
                </View>

                {currentWork ? (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{isZh ? '当前工作' : 'Current work'}</Text></View>
                        <Pressable style={({ pressed }) => [styles.card, styles.currentCard, pressed && styles.activityPressed]} onPress={() => openWork(currentWork)}>
                            <View style={styles.currentTop}>
                                <View style={styles.currentIcon}><Ionicons name="play-outline" size={20} color={statusColor(currentWork.status, theme)} /></View>
                                <View style={styles.currentBody}>
                                    <Text style={styles.currentTitle}>{currentWork.title}</Text>
                                    <Text style={styles.currentSummary}>{currentWork.summary}</Text>
                                    <View style={styles.currentMeta}>
                                        <View style={styles.metaChip}><Text style={styles.metaChipText}>{currentWork.statusLabel}</Text></View>
                                        <View style={styles.metaChip}><Text style={styles.metaChipText}>{currentWork.sourceLabel}</Text></View>
                                    </View>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                            </View>
                        </Pressable>
                    </View>
                ) : null}

                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{isZh ? '最近活动' : 'Recent activity'}</Text>
                        {agentWork.length ? <Text style={styles.sectionAction}>{isZh ? `${agentWork.length} 项工作` : `${agentWork.length} work items`}</Text> : null}
                    </View>
                    {activity.length ? (
                        <View style={styles.card}>
                            {activity.map((event, index) => (
                                <React.Fragment key={`${event.executionId}-${event.id}`}>
                                    <Pressable style={({ pressed }) => [styles.activityRow, pressed && styles.activityPressed]} onPress={() => router.push(`/inbox/ai/executions/${event.executionId}` as never)}>
                                        <View style={styles.activityIcon}><Ionicons name={activityIcon(event.kind)} size={21} color={theme.colors.textSecondary} /></View>
                                        <View style={styles.activityBody}>
                                            <Text style={styles.activityTitle}>{event.title}</Text>
                                            {event.body ? <Text style={styles.activityBodyText} numberOfLines={2}>{event.body}</Text> : null}
                                            <Text style={styles.activityTime}>{event.timeLabel}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                                    </Pressable>
                                    {index < activity.length - 1 ? <View style={styles.divider} /> : null}
                                </React.Fragment>
                            ))}
                        </View>
                    ) : agentWork.length ? (
                        <View style={styles.card}>
                            {agentWork.slice(0, 5).map((work, index) => (
                                <React.Fragment key={work.id}>
                                    <Pressable style={({ pressed }) => [styles.activityRow, pressed && styles.activityPressed]} onPress={() => openWork(work)}>
                                        <View style={styles.activityIcon}><Ionicons name="checkmark-circle-outline" size={21} color={statusColor(work.status, theme)} /></View>
                                        <View style={styles.activityBody}>
                                            <Text style={styles.activityTitle}>{work.title}</Text>
                                            <Text style={styles.activityBodyText} numberOfLines={2}>{work.summary}</Text>
                                            <Text style={styles.activityTime}>{work.statusLabel} · {work.sourceLabel}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                                    </Pressable>
                                    {index < Math.min(agentWork.length, 5) - 1 ? <View style={styles.divider} /> : null}
                                </React.Fragment>
                            ))}
                        </View>
                    ) : (
                        <View style={[styles.card, styles.empty]}><Text style={styles.emptyText}>{isZh ? '还没有活动记录。分配任务后，进展和结果会显示在这里。' : 'No activity yet. Progress and results will appear here after work is assigned.'}</Text></View>
                    )}
                </View>

                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{isZh ? '所属团队' : 'Teams'}</Text>
                        {teams.length > 0 ? <Text style={styles.sectionAction}>{isZh ? `${teams.length} 个团队` : `${teams.length} ${teams.length === 1 ? 'team' : 'teams'}`}</Text> : null}
                    </View>
                    {teams.length > 0 ? (
                        <View style={styles.card}>
                            {teams.map((team, index) => (
                                <React.Fragment key={team.id}>
                                    <Pressable style={({ pressed }) => [styles.activityRow, pressed && styles.activityPressed]} onPress={() => router.push(`/settings/teams/${team.id}` as never)}>
                                        <AiTeamAvatar size={38} />
                                        <View style={styles.activityBody}>
                                            <Text style={styles.activityTitle}>{team.name}</Text>
                                            <Text style={styles.activityBodyText} numberOfLines={2}>{team.description}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                                    </Pressable>
                                    {index < teams.length - 1 ? <View style={styles.divider} /> : null}
                                </React.Fragment>
                            ))}
                        </View>
                    ) : (
                        <View style={[styles.card, styles.empty]}>
                            <Text style={styles.emptyText}>{isZh ? '这个 Agent 暂未加入任何团队。' : 'This agent is not part of any team.'}</Text>
                        </View>
                    )}
                </View>

                <View style={styles.section}>
                    <View style={styles.definitionCard}>
                        <View style={styles.definitionHeader}>
                            <Text style={styles.definitionTitle}>{isZh ? 'Agent 定义' : 'Agent definition'}</Text>
                            <RoundButton
                                size="normal"
                                display="outline"
                                title={isZh ? '编辑' : 'Edit'}
                                icon={<Ionicons name="create-outline" size={16} color={theme.colors.text} />}
                                onPress={() => router.push(`/settings/agents/edit/${agent.id}` as never)}
                            />
                        </View>
                        <Text style={styles.instructionLabel}>{isZh ? '工作要求' : 'Instructions'}</Text>
                        <Text style={styles.instructionText} numberOfLines={5}>{agent.settings.instructions || (isZh ? '尚未添加工作要求。' : 'No instructions added yet.')}</Text>
                        <View style={styles.definitionDivider} />
                        <View style={styles.definitionRows}>
                            <View style={styles.definitionRow}><View style={styles.definitionIcon}><Ionicons name="terminal-outline" size={18} color={theme.colors.textSecondary} /></View><Text style={styles.definitionLabel}>{isZh ? '执行引擎' : 'Engine'}</Text><Text style={styles.definitionValue}>{engineLabels[agent.settings.engine]}</Text></View>
                            <View style={styles.definitionRow}><View style={styles.definitionIcon}><Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.textSecondary} /></View><Text style={styles.definitionLabel}>{isZh ? '安全策略' : 'Safety'}</Text><Text style={styles.definitionValue}>{permissionLabels[agent.settings.permissionMode]}</Text></View>
                            <View style={styles.definitionRow}><View style={styles.definitionIcon}><Ionicons name="people-outline" size={18} color={theme.colors.textSecondary} /></View><Text style={styles.definitionLabel}>{isZh ? '访问范围' : 'Access'}</Text><Text style={styles.definitionValue}>{accessLabel}</Text></View>
                        </View>
                    </View>
                </View>
            </ScrollView>
            <ActionMenuModal
                visible={menuVisible}
                title={agent.name}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
                deferItemPress
            />
        </View>
    );
}

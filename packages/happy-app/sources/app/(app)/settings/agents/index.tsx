import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { AiAgentPresenceDot, AiIdentityAvatar } from '@/features/aiTeams/components';
import { IconButton } from '@/components/IconButton';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import {
    deleteManagedAiAgent,
    duplicateManagedAiAgent,
    saveManagedAiAgent,
    useManagedAiTeamData,
} from '@/features/aiTeams/agentStore';
import type { AiAgent } from '@/features/aiTeams/types';
import { deriveAiAgentPresence, getAiAgentPresenceLabel } from '@/features/aiTeams/agentPresence';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 920, alignSelf: 'center', paddingHorizontal: { xs: 16, md: 28 }, paddingTop: { xs: 16, md: 22 }, paddingBottom: { xs: 48, md: 80 } },
    toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: { xs: 18, md: 22 } },
    filters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    chip: { minHeight: { xs: 36, md: 40 }, paddingHorizontal: { xs: 12, md: 14 }, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.divider, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.surface },
    chipActive: { backgroundColor: theme.colors.surfaceHigh },
    chipText: { color: theme.colors.text, fontSize: { xs: 14, md: 15 }, fontWeight: '500' },
    tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 10 },
    agentHeader: { flex: 1, color: theme.colors.textSecondary, fontSize: 14 },
    statusHeader: { width: 180, color: theme.colors.textSecondary, fontSize: 14 },
    listCard: { backgroundColor: theme.colors.surface, gap: 4 },
    row: { minHeight: { xs: 76, md: 84 }, paddingHorizontal: { xs: 12, md: 18 }, paddingVertical: { xs: 12, md: 14 }, borderRadius: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface },
    rowPressed: { backgroundColor: theme.colors.surfaceHigh },
    agentCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: { xs: 11, md: 13 } },
    agentText: { flex: 1, minWidth: 0 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    name: { color: theme.colors.text, fontSize: { xs: 16, md: 17 }, fontWeight: '600' },
    localBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.colors.surfaceHighest },
    localBadgeText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
    description: { color: theme.colors.textSecondary, fontSize: { xs: 13, md: 14 }, marginTop: 3 },
    statusCell: { width: { xs: 18, md: 180 }, flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusText: { color: theme.colors.textSecondary, fontSize: 14, display: { xs: 'none', md: 'flex' } },
    empty: { alignItems: 'center', paddingVertical: 96, paddingHorizontal: 24 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHigh, marginBottom: 18 },
    emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '600' },
    emptyText: { color: theme.colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 7, maxWidth: 360 },
}));

type Filter = 'all' | 'online';

export default function AiAgentsSettingsPage() {
    const router = useRouter();
    const { theme, rt } = useUnistyles();
    const styles = stylesheet;
    const data = useManagedAiTeamData();
    const isZh = getCurrentLanguage().startsWith('zh');
    const isCompact = rt.screen.width < 500;
    const [filter, setFilter] = React.useState<Filter>('all');
    const [menuAgent, setMenuAgent] = React.useState<AiAgent | null>(null);
    const agents = filter === 'online'
        ? data.agents.filter((agent) => deriveAiAgentPresence(agent, data.workItems).availability === 'online')
        : data.agents;
    const createAgent = () => router.push('/settings/agents/new' as never);

    const menuItems: ActionMenuItem[] = menuAgent ? [
        { label: isZh ? '打开' : 'Open', onPress: () => router.push(`/settings/agents/${menuAgent.id}` as never) },
        {
            label: isZh ? '复制' : 'Duplicate',
            onPress: async () => {
                const copy = await duplicateManagedAiAgent(menuAgent, isZh);
                router.push(`/settings/agents/${copy.id}` as never);
            },
        },
        {
            label: menuAgent.enabled === false ? (isZh ? '恢复' : 'Restore') : (isZh ? '归档' : 'Archive'),
            onPress: () => saveManagedAiAgent({ ...menuAgent, enabled: menuAgent.enabled === false }),
        },
        {
            label: isZh ? '删除' : 'Delete',
            destructive: true,
            onPress: async () => {
                const confirmed = await Modal.confirm(
                    isZh ? '删除 Agent？' : 'Delete agent?',
                    isZh ? `“${menuAgent.name}”的本地定义将被删除。` : `The local definition for “${menuAgent.name}” will be deleted.`,
                    { confirmText: isZh ? '删除' : 'Delete', destructive: true },
                );
                if (confirmed) await deleteManagedAiAgent(menuAgent.id);
            },
        },
    ] : [];


    return (
        <View style={styles.screen}>
            <Stack.Screen
                options={{
                    headerTitle: `${isZh ? 'Agent' : 'Agents'}  ${data.agents.length}`,
                    headerRight: () => (
                        <IconButton
                            size="normal"
                            display="plain"
                            accessibilityLabel={isZh ? '创建 Agent' : 'Create agent'}
                            icon={<Ionicons name="add" size={25} color={theme.colors.header.tint} />}
                            onPress={createAgent}
                        />
                    ),
                }}
            />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.toolbar}>
                    <View style={styles.filters}>
                        <Pressable style={[styles.chip, filter === 'all' && styles.chipActive]} onPress={() => setFilter('all')}>
                            <Text style={styles.chipText}>{isZh ? '全部' : 'All'}</Text>
                            <Text style={styles.chipText}>{data.agents.length}</Text>
                        </Pressable>
                        <Pressable style={[styles.chip, filter === 'online' && styles.chipActive]} onPress={() => setFilter('online')}>
                            <AiAgentPresenceDot availability="online" size={8} />
                            <Text style={styles.chipText}>{isZh ? '在线' : 'Online'}</Text>
                        </Pressable>
                    </View>
                </View>

                {agents.length ? (
                    <View>
                        {Platform.OS === 'web' && !isCompact ? (
                            <View style={styles.tableHeader}>
                                <Text style={styles.agentHeader}>{isZh ? 'Agent' : 'Agent'}</Text>
                                <Text style={styles.statusHeader}>{isZh ? '状态' : 'Status'}</Text>
                                <View style={{ width: 40 }} />
                            </View>
                        ) : null}
                        <View style={styles.listCard}>
                        {agents.map((agent) => {
                            const presence = deriveAiAgentPresence(agent, data.workItems);
                            return (
                                <React.Fragment key={agent.id}>
                                    <Pressable
                                        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                                        onPress={() => router.push(`/settings/agents/${agent.id}` as never)}
                                    >
                                        <View style={styles.agentCell}>
                                            <AiIdentityAvatar id={agent.id} name={agent.emoji || agent.name} size={isCompact ? 42 : 46} />
                                            <View style={styles.agentText}>
                                                <View style={styles.nameLine}>
                                                    <Text style={styles.name} numberOfLines={1}>{agent.name}</Text>
                                                </View>
                                                <Text style={styles.description} numberOfLines={1}>{agent.description || agent.role}</Text>
                                            </View>
                                        </View>
                                        <View style={styles.statusCell}>
                                            <AiAgentPresenceDot availability={presence.availability} size={9} />
                                            <Text style={styles.statusText}>{getAiAgentPresenceLabel(presence, isZh)}</Text>
                                        </View>
                                        <IconButton
                                            size={isCompact ? 'small' : 'normal'}
                                            accessibilityLabel={isZh ? '更多操作' : 'More actions'}
                                            icon={<Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.textSecondary} />}
                                            onPress={(event) => { event.stopPropagation(); setMenuAgent(agent); }}
                                        />
                                    </Pressable>
                                </React.Fragment>
                            );
                        })}
                        </View>
                    </View>
                ) : (
                    <View style={styles.empty}>
                        <View style={styles.emptyIcon}><Ionicons name="sparkles-outline" size={28} color={theme.colors.textSecondary} /></View>
                        <Text style={styles.emptyTitle}>{isZh ? '还没有 Agent' : 'No agents yet'}</Text>
                        <Text style={styles.emptyText}>{isZh ? '创建一个 Agent，定义它负责什么以及应该如何工作。' : 'Create an agent and define what it should do and how it should work.'}</Text>
                    </View>
                )}
            </ScrollView>
            <ActionMenuModal
                visible={menuAgent !== null}
                title={menuAgent?.name}
                items={menuItems}
                onClose={() => setMenuAgent(null)}
                deferItemPress
            />
        </View>
    );
}

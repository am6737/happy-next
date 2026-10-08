import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import type { AiTeamData } from './types';
import { getConversationWorkItems } from './conversationWorkItems';

const styles = StyleSheet.create((theme) => ({
    container: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface },
    header: { minHeight: 42, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
    count: { color: theme.colors.textSecondary, fontSize: 12 },
    list: { paddingHorizontal: 18, paddingBottom: 10, gap: 3 },
    row: { minHeight: 46, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowPressed: { backgroundColor: theme.colors.surfaceHigh },
    dot: { width: 7, height: 7, borderRadius: 4 },
    rowBody: { flex: 1, minWidth: 0 },
    title: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    meta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
}));

export function ConversationTaskNavigator({ data, conversationId, isZh, selectedWorkItemId, onSelectWork, onOpenWork }: {
    data: AiTeamData;
    conversationId: string;
    isZh: boolean;
    selectedWorkItemId?: string;
    onSelectWork: (workItemId: string | undefined) => void;
    onOpenWork: (workItemId: string) => void;
}) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const works = getConversationWorkItems(data, conversationId);
    if (!works.length) return null;

    return <View style={styles.container}>
        <Pressable style={styles.header} onPress={() => setExpanded((value) => !value)} accessibilityRole="button" accessibilityLabel={isZh ? `本会话任务，${works.length} 项` : `Conversation tasks, ${works.length}`}>
            <Ionicons name="git-branch-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={styles.heading}>{selectedWorkItemId ? (isZh ? '继续指定任务' : 'Continue selected task') : (isZh ? '本会话任务' : 'Conversation tasks')}</Text>
            <Text style={styles.count}>{works.length}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textSecondary} />
        </Pressable>
        {expanded ? <View style={styles.list}>
            <Pressable style={styles.row} onPress={() => onSelectWork(undefined)} accessibilityRole="radio" accessibilityState={{ selected: !selectedWorkItemId }}>
                <Ionicons name={selectedWorkItemId ? 'ellipse-outline' : 'radio-button-on'} size={18} color={theme.colors.textLink} />
                <Text style={styles.title}>{isZh ? '新消息 / 新任务' : 'New message / task'}</Text>
            </Pressable>
            {works.map((work) => {
                const assignee = data.agents.find((agent) => agent.id === work.assigneeId);
                const execution = data.executions.find((item) => item.workItemId === work.id);
                const canContinue = execution?.status === 'completed' || execution?.status === 'failed' || execution?.status === 'running';
                const color = work.status === 'done' ? theme.colors.success
                    : work.status === 'blocked' ? theme.colors.textDestructive
                    : work.status === 'working' || work.status === 'review' ? theme.colors.textLink
                    : theme.colors.textSecondary;
                return <Pressable key={work.id} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => onSelectWork(work.id)} accessibilityRole="radio" accessibilityState={{ selected: selectedWorkItemId === work.id }}>
                    <Ionicons name={selectedWorkItemId === work.id ? 'radio-button-on' : 'ellipse-outline'} size={18} color={theme.colors.textLink} />
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <View style={styles.rowBody}>
                        <Text style={styles.title} numberOfLines={1}>{work.title}</Text>
                        <Text style={styles.meta} numberOfLines={1}>{assignee?.name ?? '-'} · {work.statusLabel}{execution?.status === 'running' ? (isZh ? ' · 可补充指令' : ' · Can steer') : canContinue ? '' : (isZh ? ' · 查看活动子任务' : ' · View active tasks')}</Text>
                    </View>
                    <Pressable onPress={() => onOpenWork(work.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={isZh ? '查看执行详情' : 'Open run details'}>
                        <Ionicons name="open-outline" size={17} color={theme.colors.textSecondary} />
                    </Pressable>
                </Pressable>;
            })}
        </View> : null}
    </View>;
}

import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AiIdentityAvatar } from '@/features/aiTeams/components';
import { findAiAgent, findAiExecution, findAiWorkItem, getAiWorkSourcePath, type AiExecutionEvent, type AiExecutionStatus } from '@/features/aiTeams/mockData';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { getCurrentLanguage } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 22 },
    runCard: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 14,
        paddingVertical: 13,
    },
    runTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    runBody: { flex: 1, minWidth: 0, gap: 4 },
    runHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    runIdentity: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    runAgent: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    aiText: { ...Typography.default('semiBold'), color: theme.colors.textLink, fontSize: 9, letterSpacing: 0.3 },
    runStatus: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto', flexShrink: 0 },
    runSummary: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, minWidth: 0 },
    statusDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
    workLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    workLinkText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flex: 1 },
    contextLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    contextLabel: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12 },
    contextValue: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 12, flex: 1 },
    bottomBar: { backgroundColor: theme.colors.surface, paddingTop: 10, paddingHorizontal: 16 },
    bottomBarInner: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' },
    sessionButton: { minHeight: 44, borderRadius: 11, backgroundColor: theme.colors.button.primary.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 16 },
    sessionButtonText: { ...Typography.default('semiBold'), color: theme.colors.button.primary.tint, fontSize: 14 },
    activitySection: { gap: 5 },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 },
    groupLabel: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14 },
    groupCount: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto' },
    eventList: { gap: 4 },
    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingLeft: 28 },
    eventIcon: { width: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    eventText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, flex: 1, minWidth: 0 },
    eventActor: { ...Typography.default('semiBold'), color: theme.colors.textSecondary, fontSize: 13 },
    eventTime: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flexShrink: 0 },
}));

function statusColor(status: AiExecutionStatus): string {
    switch (status) {
        case 'completed': return '#34C759';
        case 'failed': return '#FF3B30';
        case 'cancelled': return '#8E8E93';
        case 'waiting_human': return '#FF9500';
        case 'reviewing': return '#AF52DE';
        case 'queued': return '#8E8E93';
        case 'dispatched': return '#5AC8FA';
        case 'running': return '#0A84FF';
    }
}

function eventIcon(event: AiExecutionEvent): React.ComponentProps<typeof Ionicons>['name'] {
    if (event.kind === 'tool') return 'terminal-outline';
    if (event.kind === 'result') return event.status === 'failed' ? 'close-circle-outline' : 'checkmark-circle-outline';
    if (event.kind === 'comment') return 'chatbubble-outline';
    if (event.status === 'waiting_human') return 'help-circle-outline';
    if (event.status === 'running' || event.status === 'reviewing') return 'play-circle-outline';
    if (event.status === 'queued') return 'time-outline';
    if (event.status === 'dispatched') return 'arrow-forward-circle-outline';
    return 'ellipse-outline';
}

export default function AiExecutionDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const insets = useSafeAreaInsets();
    const isZh = getCurrentLanguage().startsWith('zh');
    const data = useManagedAiTeamData();
    const execution = findAiExecution(data, id);
    const navigateToSession = useNavigateToSession();
    const [expanded, setExpanded] = React.useState(true);

    const agent = execution ? findAiAgent(data, execution.agentId) : undefined;

    if (!execution) {
        return <View style={styles.container}><Stack.Screen options={{ headerTitle: isZh ? '执行详情' : 'Run details' }} /><Text style={{ color: theme.colors.text, padding: 24 }}>{isZh ? '未找到执行记录' : 'Run not found'}</Text></View>;
    }

    const work = findAiWorkItem(data, execution.workItemId);
    const conversation = execution.conversationId ? data.conversations.find((item) => item.id === execution.conversationId) : undefined;
    const color = statusColor(execution.status);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: isZh ? `第${execution.attempt}次执行` : `Run ${execution.attempt}` }} />
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.runCard}>
                    <View style={styles.runTopRow}>
                        {agent ? <AiIdentityAvatar id={agent.id} name={agent.name} size={30} /> : null}
                        <View style={styles.runBody}>
                            <View style={styles.runHeader}>
                                <View style={styles.runIdentity}>
                                    <Text style={styles.runAgent}>{agent?.name ?? '-'}</Text>
                                    <Text style={styles.aiText}>AI</Text>
                                </View>
                                <Text style={styles.runStatus}>{execution.statusLabel}</Text>
                                <View style={[styles.statusDot, { backgroundColor: color }]} />
                            </View>
                            <Text style={styles.runSummary} numberOfLines={1}>{execution.summary}</Text>
                        </View>
                    </View>
                    {work ? (
                        <Pressable style={styles.workLink} onPress={() => { const path = getAiWorkSourcePath(work); if (path) router.push(path as never); }}>
                            <Ionicons name="link-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.workLinkText} numberOfLines={1}>{work.sourceLabel} · {work.title}</Text>
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    ) : null}
                    {conversation ? (
                        <Pressable style={styles.contextLink} onPress={() => router.push(`/inbox/ai/${conversation.id}` as never)}>
                            <Ionicons name="chatbubble-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.contextLabel}>{isZh ? '相关聊天' : 'Related chat'}</Text>
                            <Text style={styles.contextValue} numberOfLines={1}>{conversation.title}</Text>
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    ) : null}
                </View>

                <View style={styles.activitySection}>
                    <Pressable style={styles.groupHeader} onPress={() => setExpanded((value) => !value)}>
                        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={theme.colors.textSecondary} />
                        <Text style={styles.groupLabel}>{isZh ? '执行记录' : 'Execution log'}</Text>
                        <Text style={styles.groupCount}>
                            {isZh ? `${execution.events.length} 条记录` : `${execution.events.length} entries`}
                        </Text>
                    </Pressable>
                    {expanded && (
                        <View style={styles.eventList}>
                            {execution.events.map((event) => {
                                const eventAgent = event.agentId ? findAiAgent(data, event.agentId) : undefined;
                                const eventColor = event.status ? statusColor(event.status) : theme.colors.textSecondary;
                                const actorName = event.actor === 'agent' ? eventAgent?.name : event.actor === 'human' ? (isZh ? '你' : 'You') : null;
                                return (
                                    <View key={event.id} style={styles.eventRow}>
                                        <View style={styles.eventIcon}>
                                            <Ionicons name={eventIcon(event)} size={17} color={eventColor} />
                                        </View>
                                        <Text style={styles.eventText} numberOfLines={1}>
                                            {actorName ? <Text style={styles.eventActor}>{actorName}{event.actor === 'agent' ? ' AI' : ''} </Text> : null}
                                            <Text style={styles.eventText}>{event.kind === 'comment' && event.body ? event.body : event.title}</Text>
                                        </Text>
                                        <Text style={styles.eventTime}>{event.timeLabel}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

            </ScrollView>
            {execution.sessionId ? (
                <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                    <View style={styles.bottomBarInner}>
                        <Pressable style={styles.sessionButton} onPress={() => navigateToSession(execution.sessionId!)}>
                            <Ionicons name="terminal-outline" size={17} color={theme.colors.button.primary.tint} />
                            <Text style={styles.sessionButtonText}>{isZh ? '打开执行 Session' : 'Open execution session'}</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}
        </View>
    );
}

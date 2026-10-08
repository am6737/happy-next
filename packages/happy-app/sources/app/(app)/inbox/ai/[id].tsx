import * as React from 'react';
import { FlatList, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { ChatHeaderTitle } from '@/components/ChatHeaderTitle';
import { AgentContentView } from '@/components/AgentContentView';
import { ChatInput } from '@/components/dootask/ChatInput';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AiGroupAvatar, AiIdentityAvatar, getAiAvatarColor } from '@/features/aiTeams/components';
import { ConversationTaskNavigator } from '@/features/aiTeams/ConversationTaskNavigator';
import { getConversationWorkItems } from '@/features/aiTeams/conversationWorkItems';
import { getAiTeamCopy } from '@/features/aiTeams/copy';
import { findAiAgent, findAiWorkItem, getAiWorkSourcePath, type AiChatMessage } from '@/features/aiTeams/types';
import { fetchManagedAiCollaboration, fetchManagedAiPendingClarifications, fetchManagedAiSteeringStatus, retryManagedAiSteering, sendManagedAiMessage, useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import type { AiCollaboration, AiMessageResponse, AiPendingClarification, AiSteeringStatus } from '@/sync/apiAiTeams';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { getNativeHeaderTitleWidth } from '@/utils/nativeHeaderTitleWidth';
import { isRunningOnMac } from '@/utils/platform';
import { useIsTablet } from '@/utils/responsive';
import { Modal } from '@/modal';

const AVATAR_SIZE = 36;
const AVATAR_GAP = 10;

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    list: { flex: 1 },
    listContent: {
        paddingVertical: theme.margins.sm,
        flexGrow: 1,
    },
    itemWithAvatar: { marginBottom: 22 },
    itemWithoutAvatar: { marginBottom: 10 },
    otherRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: theme.margins.lg,
        paddingVertical: 1,
    },
    avatarColumn: {
        width: AVATAR_SIZE,
        marginRight: AVATAR_GAP,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    otherContent: {
        flex: 1,
        flexShrink: 1,
        minWidth: 0,
        maxWidth: '100%',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: theme.margins.sm,
        marginBottom: 2,
        minHeight: 20,
    },
    senderName: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        lineHeight: 20,
        flexShrink: 1,
        minWidth: 0,
    },
    aiBadge: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceHighest,
    },
    aiBadgeText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 9,
        lineHeight: 12,
        letterSpacing: 0.4,
    },
    headerTime: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
        flexShrink: 0,
    },
    selfRow: {
        paddingHorizontal: theme.margins.lg,
        alignItems: 'flex-end',
    },
    selfContent: {
        alignItems: 'flex-end',
        maxWidth: '78%',
        minWidth: 0,
    },
    selfBubble: {
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.surfaceHigh,
    },
    selfTime: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 11,
        marginTop: 2,
    },
    messageText: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 15,
        lineHeight: 22,
        maxWidth: '100%',
        flexShrink: 1,
    },
    decisionMessage: {
        width: '100%',
        maxWidth: 560,
        marginTop: theme.margins.xs,
    },
    decisionOptions: {
        marginTop: 6,
        gap: 3,
    },
    decisionOptionText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 21,
    },
    decisionOptionSelected: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    progressMessage: {
        width: '100%',
        maxWidth: 560,
        marginTop: theme.margins.xs,
        gap: 4,
    },
    progressDetail: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 21,
    },
    assignmentMessage: {
        width: '100%',
        maxWidth: 560,
        marginTop: theme.margins.xs,
    },
    assignmentHeader: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    assignmentTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 14,
        flex: 1,
    },
    assignmentCount: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    assignmentList: { gap: 5, marginTop: 6 },
    assignmentRow: { minHeight: 42, paddingHorizontal: 10, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.surfaceHigh, flexDirection: 'row', alignItems: 'center', gap: theme.margins.sm },
    assignmentDot: { width: 7, height: 7, borderRadius: 4 },
    assignmentBody: { flex: 1, minWidth: 0 },
    assignmentWork: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13 },
    assignmentMeta: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
    workAttachment: {
        width: '100%',
        maxWidth: 560,
        marginTop: 12,
    },
    workLinkRow: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 7,
    },
    workLinkText: {
        ...Typography.default(),
        color: theme.colors.textLink,
        fontSize: 14,
        lineHeight: 20,
        flex: 1,
    },
    workMessage: {
        borderRadius: theme.borderRadius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
    },
    workPreview: {
        paddingHorizontal: theme.margins.md,
        paddingTop: 12,
        paddingBottom: 11,
    },
    workTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 20,
    },
    workSourceGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 1,
        minWidth: 0,
    },
    workSourceLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 19,
        flexShrink: 1,
        minWidth: 0,
    },
    workTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 15,
        lineHeight: 21,
        marginTop: 8,
    },
    workSummary: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        marginTop: 5,
    },
    headerIconButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 18,
    },
    contextBar: { paddingHorizontal: 18, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh, gap: 5 },
    contextTitle: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13 },
    contextText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
    contextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    contextAction: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    contextActionText: { ...Typography.default('semiBold'), color: theme.colors.textLink, fontSize: 12 },
}));

export default function AiConversationScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const copy = getAiTeamCopy();
    const data = useManagedAiTeamData();
    const conversation = data.conversations.find((item) => item.id === id);
    const agent = conversation ? findAiAgent(data, conversation.agentId) : undefined;
    const { width: screenWidth } = useWindowDimensions();
    const isTablet = useIsTablet();
    const messages = conversation ? data.messages[conversation.id] ?? [] : [];
    const [expandedAssignmentId, setExpandedAssignmentId] = React.useState<string | null>('tl-assignment');
    const [selectedWorkItemId, setSelectedWorkItemId] = React.useState<string | undefined>();
    const [selectedAssigneeId, setSelectedAssigneeId] = React.useState<string | undefined>();
    const [selectedTaskId, setSelectedTaskId] = React.useState<string | undefined>();
    const [collaboration, setCollaboration] = React.useState<AiCollaboration | null>(null);
    const [steering, setSteering] = React.useState<{ workItemId: string; steeringId: string; status: AiSteeringStatus['status'] } | null>(null);
    const [clarification, setClarification] = React.useState<Extract<AiMessageResponse, { kind: 'clarify' }> | null>(null);
    const [pendingClarifications, setPendingClarifications] = React.useState<AiPendingClarification[]>([]);
    const pending = pendingClarifications[0];
    const persistedClarification = pending ? { kind: 'clarify' as const, clarificationId: pending.id,
        conversationId: conversation?.id ?? '', question: pending.question,
        candidates: pending.candidates ?? [], targetWorkItemId: pending.targetWorkItemId } : null;
    const activeClarification = clarification ?? persistedClarification;

    React.useEffect(() => {
        setExpandedAssignmentId(conversation?.kind === 'group' ? 'tl-assignment' : null);
        setSelectedWorkItemId(undefined);
        setSelectedAssigneeId(undefined);
        setSelectedTaskId(undefined);
        setSteering(null);
        setClarification(null);
        setPendingClarifications([]);
    }, [conversation?.id]);

    React.useEffect(() => {
        if (!conversation?.id) return;
        let active = true;
        fetchManagedAiPendingClarifications(conversation.id).then((items) => {
            if (active) setPendingClarifications(items);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [conversation?.id]);

    React.useEffect(() => {
        if (!selectedWorkItemId) { setCollaboration(null); setSelectedTaskId(undefined); return; }
        let active = true;
        setCollaboration(null);
        setSelectedTaskId(undefined);
        fetchManagedAiCollaboration(selectedWorkItemId).then((result) => {
            if (active) setCollaboration(result);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [selectedWorkItemId]);

    React.useEffect(() => {
        if (!steering || steering.status === 'delivered' || steering.status === 'blocked') return;
        const timer = setInterval(() => {
            fetchManagedAiSteeringStatus(steering.workItemId, steering.steeringId).then((result) => {
                setSteering((current) => current?.steeringId === result.id ? { ...current, status: result.status } : current);
            }).catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [steering?.workItemId, steering?.steeringId, steering?.status]);

    const handleSendText = React.useCallback(async (text: string) => {
        if (!conversation) throw new Error('Conversation is unavailable');
        try {
            const selectedExecution = data.executions.find((item) => item.workItemId === selectedWorkItemId);
            const activeTasks = collaboration?.tasks.filter((task) => task.status === 'running') ?? [];
            const isSteering = activeTasks.length > 0;
            if (isSteering && activeTasks.length > 1 && !selectedTaskId) throw new Error(getCurrentLanguageIsChinese() ? '请先选择正在运行的子任务' : 'Select a running task first');
            if (selectedWorkItemId && !isSteering && selectedExecution?.status !== 'completed' && selectedExecution?.status !== 'failed')
                throw new Error(getCurrentLanguageIsChinese() ? '此任务尚未到可继续状态' : 'This task cannot be continued yet');
            const result = await sendManagedAiMessage(conversation.id, text, activeClarification
                ? { clarificationId: activeClarification.clarificationId, targetWorkItemId: selectedWorkItemId ?? activeClarification.targetWorkItemId ?? undefined, assigneeId: selectedAssigneeId }
                : selectedWorkItemId ? { mode: isSteering ? 'steer' : 'continue', targetWorkItemId: selectedWorkItemId, targetTaskId: isSteering ? selectedTaskId ?? activeTasks[0]?.id : undefined } : {});
            setClarification('kind' in result && result.kind === 'clarify' ? result : null);
            if (!('kind' in result && result.kind === 'clarify')) setPendingClarifications((items) => items.filter((item) => item.id !== activeClarification?.clarificationId));
            fetchManagedAiPendingClarifications(conversation.id).then(setPendingClarifications).catch(() => undefined);
            if (!('kind' in result && result.kind === 'clarify')) setSelectedAssigneeId(undefined);
            if ('steeringId' in result) setSteering({ workItemId: result.targetWorkItemId, steeringId: result.steeringId, status: 'pending' });
        } catch (error) {
            Modal.alert(getCurrentLanguageIsChinese() ? '发送失败，请重试' : 'Could not send. Please retry.', error instanceof Error ? error.message : undefined);
            throw error;
        }
    }, [conversation?.id, activeClarification?.clarificationId, selectedWorkItemId, selectedAssigneeId, selectedTaskId, collaboration, data.executions]);

    if (!conversation || !agent) {
        return <View style={styles.body}><Text style={{ color: theme.colors.text, padding: 24 }}>{copy.notFound}</Text></View>;
    }

    const showWork = (workItemId: string) => {
        const work = findAiWorkItem(data, workItemId);
        if (!work) return;
        const path = getAiWorkSourcePath(work);
        if (path) router.push(path as never);
    };

    const openWorkExecution = (workItemId: string) => {
        const executionId = findAiWorkItem(data, workItemId)?.executionIds.at(-1);
        if (executionId) router.push(`/inbox/ai/executions/${executionId}` as never);
    };

    const listMessages = [...messages].reverse();

    const renderAgentContent = (message: AiChatMessage): React.ReactNode => {
        if (message.kind === 'text') return <Text style={styles.messageText}>{message.text}</Text>;

        if (message.kind === 'decision') {
            return (
                <View style={styles.decisionMessage}>
                    <Text style={styles.messageText}>{message.body}</Text>
                    <View style={styles.decisionOptions}>
                        {message.options.map((option, index) => {
                            const selected = message.selectedOption === option;
                            return (
                                <Text key={option} style={[styles.decisionOptionText, selected && styles.decisionOptionSelected]}>
                                    {selected ? '✓ ' : `${index + 1}. `}{option}
                                </Text>
                            );
                        })}
                    </View>
                </View>
            );
        }

        if (message.kind === 'progress') {
            const isZh = getCurrentLanguageIsChinese();
            return (
                <View style={styles.progressMessage}>
                    <Text style={styles.messageText}>
                        {isZh ? `${message.title}目前大约完成了 ${message.progress}%。` : `${message.title} is about ${message.progress}% complete.`}
                    </Text>
                    {message.completed.length > 0 ? <Text style={styles.progressDetail}>{isZh ? `已经完成：${message.completed.join('、')}。` : `Completed: ${message.completed.join(', ')}.`}</Text> : null}
                    {message.active.length > 0 ? <Text style={styles.progressDetail}>{isZh ? `现在在做：${message.active.join('、')}。` : `In progress: ${message.active.join(', ')}.`}</Text> : null}
                    {message.pending.length > 0 ? <Text style={styles.progressDetail}>{isZh ? `接下来：${message.pending.join('、')}。` : `Next: ${message.pending.join(', ')}.`}</Text> : null}
                </View>
            );
        }

        if (message.kind === 'assignment') {
            const works = message.workItemIds.map((workId) => findAiWorkItem(data, workId)).filter((work) => work !== undefined);
            const expanded = expandedAssignmentId === message.id;
            return (
                <View style={styles.assignmentMessage}>
                    <Pressable style={styles.assignmentHeader} onPress={() => setExpandedAssignmentId(expanded ? null : message.id)}>
                        <Ionicons name="git-branch-outline" size={16} color={theme.colors.textSecondary} />
                        <Text style={styles.assignmentTitle}>{message.title}</Text>
                        <Text style={styles.assignmentCount}>{getCurrentLanguageIsChinese() ? `${works.length} 项` : `${works.length} items`}</Text>
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={theme.colors.textSecondary} />
                    </Pressable>
                    {expanded ? (
                        <View style={styles.assignmentList}>
                            {works.map((work) => {
                                const assignee = findAiAgent(data, work.assigneeId);
                                const dotColor = work.status === 'done' ? theme.colors.success : work.status === 'blocked' ? theme.colors.textDestructive : work.status === 'working' || work.status === 'review' ? theme.colors.textLink : theme.colors.textSecondary;
                                return (
                                    <Pressable key={work.id} style={styles.assignmentRow} onPress={() => showWork(work.id)}>
                                        <View style={[styles.assignmentDot, { backgroundColor: dotColor }]} />
                                        <View style={styles.assignmentBody}>
                                            <Text style={styles.assignmentWork} numberOfLines={1}>{work.title}</Text>
                                            <Text style={styles.assignmentMeta}>{assignee?.name ?? '-'} · {work.statusLabel}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}
                </View>
            );
        }

        if (message.kind === 'work') {
            const work = findAiWorkItem(data, message.workItemId);
            if (!work) return null;
            const githubSource = work.sourceType === 'github'
                ? work.sourceResourceId.match(/^([^/]+)\/([^#]+)#(\d+)$/)
                : null;
            const sourceProvider = work.sourceType === 'github'
                ? 'github.com'
                : work.sourceType === 'dootask'
                    ? 'DooTask'
                    : work.sourceType === 'session'
                        ? 'Session'
                        : (getCurrentLanguageIsChinese() ? '执行记录' : 'Run');
            const previewTitle = githubSource
                ? `${work.title} · Issue #${githubSource[3]} · ${githubSource[1]}/${githubSource[2]}`
                : `${work.title} · ${work.sourceLabel}`;
            const sourceIcon = work.sourceType === 'github'
                ? 'logo-github'
                : work.sourceType === 'dootask'
                    ? 'checkbox-outline'
                    : work.sourceType === 'session'
                        ? 'chatbubble-ellipses-outline'
                        : 'terminal-outline';
            return (
                <View style={styles.workAttachment}>
                    <Pressable style={styles.workLinkRow} onPress={() => showWork(work.id)}>
                        <Ionicons name="link-outline" size={16} color={theme.colors.textLink} />
                        <Text style={styles.workLinkText} numberOfLines={1}>{previewTitle}</Text>
                    </Pressable>
                    <View style={styles.workMessage}>
                        <Pressable style={styles.workPreview} onPress={() => showWork(work.id)}>
                            <View style={styles.workTopRow}>
                                <View style={styles.workSourceGroup}>
                                    <Ionicons name={sourceIcon} size={15} color={theme.colors.textLink} />
                                    <Text style={styles.workSourceLabel} numberOfLines={1}>{sourceProvider}</Text>
                                </View>
                            </View>
                            <Text style={styles.workTitle} numberOfLines={2}>{previewTitle}</Text>
                            <Text style={styles.workSummary} numberOfLines={2}>{work.summary}</Text>
                        </Pressable>
                    </View>
                </View>
            );
        }

        return <Text style={styles.messageText}>{message.body}</Text>;
    };

    const renderMessage = ({ item, index }: { item: AiChatMessage; index: number }) => {
        const olderMessage = index < listMessages.length - 1 ? listMessages[index + 1] : null;
        const senderKey = item.sender === 'user' ? 'human:self' : `agent:${item.agentId ?? conversation.agentId}`;
        const olderSenderKey = !olderMessage
            ? null
            : olderMessage.sender === 'user'
                ? 'human:self'
                : `agent:${olderMessage.agentId ?? conversation.agentId}`;
        const messageAgent = item.sender === 'agent'
            ? findAiAgent(data, item.agentId ?? conversation.agentId) ?? agent
            : agent;
        const showAvatar = item.sender === 'agent' && senderKey !== olderSenderKey;
        const isConsecutiveSameSender = olderSenderKey === senderKey;

        if (item.sender === 'user') {
            return (
                <View style={isConsecutiveSameSender ? styles.itemWithoutAvatar : styles.itemWithAvatar}>
                    <View style={styles.selfRow}>
                        <View style={styles.selfContent}>
                            <View style={styles.selfBubble}>
                                {item.kind === 'text' ? <Text style={styles.messageText}>{item.text}</Text> : null}
                            </View>
                            <Text style={styles.selfTime}>{item.timeLabel}</Text>
                        </View>
                    </View>
                </View>
            );
        }

        return (
            <View style={isConsecutiveSameSender ? styles.itemWithoutAvatar : styles.itemWithAvatar}>
                <View style={styles.otherRow}>
                    <View style={styles.avatarColumn}>
                        {showAvatar ? <AiIdentityAvatar id={messageAgent.id} name={messageAgent.name} size={AVATAR_SIZE} /> : null}
                    </View>
                    <View style={styles.otherContent}>
                        {showAvatar ? (
                            <View style={styles.headerRow}>
                                <Text style={[styles.senderName, { color: getAiAvatarColor(messageAgent.id) }]} numberOfLines={1}>{messageAgent.name}</Text>
                                <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI</Text></View>
                                <Text style={styles.headerTime}>{item.timeLabel}</Text>
                            </View>
                        ) : null}
                        {renderAgentContent(item)}
                    </View>
                </View>
            </View>
        );
    };

    const groupMembers = data.agents.filter((member) => conversation.participantAgentIds.includes(member.id));
    const openConversationDetails = () => {
        if (conversation.kind === 'direct') {
            router.push(`/settings/agents/${agent.id}` as never);
            return;
        }
        router.push(`/inbox/ai/details/${conversation.id}` as never);
    };

    const headerTitleWidth = getNativeHeaderTitleWidth({ screenWidth, rightActionCount: 1 });
    const isNarrowPhone = Platform.OS !== 'web' && !isRunningOnMac() && !isTablet;
    const leftAlignTitleWidth = Math.max(140, Math.min(screenWidth, layout.headerMaxWidth) - 148);
    const headerTitle = () => (
        <ChatHeaderTitle
            title={conversation.title}
            subtitle={conversation.subtitle}
            align={isNarrowPhone ? 'left' : 'center'}
            width={isNarrowPhone ? (Platform.OS === 'ios' ? leftAlignTitleWidth : undefined) : headerTitleWidth}
        />
    );
    const headerRight = () => (
        <Pressable
            style={styles.headerIconButton}
            hitSlop={15}
            onPress={openConversationDetails}
        >
            {conversation.kind === 'group' ? (
                <AiGroupAvatar members={groupMembers} size={36} />
            ) : (
                <AiIdentityAvatar id={agent.id} name={agent.name} size={36} />
            )}
        </Pressable>
    );

    const content = (
        <View style={styles.list}>
            <ConversationTaskNavigator data={data} conversationId={conversation.id} isZh={getCurrentLanguageIsChinese()} selectedWorkItemId={selectedWorkItemId} onSelectWork={setSelectedWorkItemId} onOpenWork={openWorkExecution} />
            {selectedWorkItemId && collaboration && collaboration.tasks.filter((task) => task.status === 'running').length > 1 ? <View style={styles.contextBar}>
                <Text style={styles.contextTitle}>{getCurrentLanguageIsChinese() ? '选择正在运行的子任务' : 'Select a running task'}</Text>
                <View style={styles.contextActions}>{collaboration.tasks.filter((task) => task.status === 'running').map((task) => <Pressable key={task.id} style={styles.contextAction} onPress={() => setSelectedTaskId(task.id)}><Text style={styles.contextActionText}>{task.title ?? task.taskKey ?? task.id}{selectedTaskId === task.id ? ' ✓' : ''}</Text></Pressable>)}</View>
            </View> : null}
            {steering ? <View style={styles.contextBar}>
                <Text style={styles.contextTitle}>{getCurrentLanguageIsChinese() ? '补充指令' : 'Steering'} · {steering.status}</Text>
                {steering.status === 'blocked' ? <Pressable style={styles.contextAction} onPress={async () => {
                    try {
                        await retryManagedAiSteering(steering.workItemId, steering.steeringId);
                        setSteering({ ...steering, status: 'pending' });
                    } catch (error) { Modal.alert(getCurrentLanguageIsChinese() ? '重试失败' : 'Retry failed', error instanceof Error ? error.message : undefined); }
                }}><Text style={styles.contextActionText}>{getCurrentLanguageIsChinese() ? '重试发送' : 'Retry delivery'}</Text></Pressable> : null}
            </View> : null}
            {activeClarification ? <View style={styles.contextBar}>
                <Text style={styles.contextTitle}>{getCurrentLanguageIsChinese() ? '等待补充说明' : 'Clarification needed'}</Text>
                <Text style={styles.contextText}>{activeClarification.question}</Text>
                <Text style={styles.contextText}>{getCurrentLanguageIsChinese() ? '选择目标后，在下方输入补充说明。' : 'Select a target, then enter your answer below.'}</Text>
                {activeClarification.candidates.length ? <View style={styles.contextActions}>{activeClarification.candidates.map((candidate) => <Pressable key={candidate.id} style={styles.contextAction} onPress={() => {
                    if (getConversationWorkItems(data, conversation.id).some((work) => work.id === candidate.id)) setSelectedWorkItemId(candidate.id);
                    else if (data.agents.some((agent) => agent.id === candidate.id)) setSelectedAssigneeId(candidate.id);
                }}><Text style={styles.contextActionText}>{candidate.name}{selectedWorkItemId === candidate.id || selectedAssigneeId === candidate.id ? ' ✓' : ''}</Text></Pressable>)}</View> : null}
            </View> : null}
            <FlatList
                data={listMessages}
                inverted
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                initialNumToRender={20}
            />
        </View>
    );
    const input = (
        <ChatInput
            onSendText={handleSendText}
            onSendImage={() => {}}
            showAttachments={false}
        />
    );

    return (
        <>
            <Stack.Screen options={{ headerTitle, headerRight, headerTitleAlign: isNarrowPhone ? 'left' : 'center' }} />
            <View style={styles.body}>
                <AgentContentView content={content} input={input} />
            </View>
        </>
    );
}

function getCurrentLanguageIsChinese(): boolean {
    return getAiTeamCopy().send === '发送';
}

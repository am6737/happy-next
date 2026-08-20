import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { Avatar } from '@/components/Avatar';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useGithubIssue, useGithubIssueComments } from '@/hooks/useGithubData';
import { updateGithubIssue, fetchGithubToken } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { storeTempData, type NewSessionData } from '@/utils/tempDataStore';
import type { RepoIssue, RepoIssueComment } from '@/data/mockRepos';
import { ShimmerView } from '@/components/ShimmerView';
import { Modal } from '@/modal';
import { hapticsLight, hapticsSuccess } from '@/components/haptics';
import {
    StatePill,
    RepoEmptyState,
    SkeletonBlock,
} from '@/components/repos';
import { IssueIcon } from '@/components/repos/IssueIcon';
import { formatTimeAgo, formatAbsoluteTime, formatSessionAge, labelColors } from '@/data/repoUtils';
import { getCurrentLanguage, t } from '@/text';
import { useLinkedSessions } from '@/hooks/useLinkedSessions';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { getSessionName } from '@/utils/sessionUtils';
import { getAiMockGithubIssue } from '@/features/aiTeams/mockGithubIssues';
import { MockIssueActivityTimeline } from '@/features/aiTeams/MockIssueActivityTimeline';
import { MockIssueExecutionLog } from '@/features/aiTeams/MockIssueExecutionLog';
import { findAiExecutionsForWork, findAiWorkItem, type AiAcceptanceStatus } from '@/features/aiTeams/mockData';
import { appendManagedAiMessages, saveManagedAiExecution, saveManagedAiWorkItem, useManagedAiTeamData } from '@/features/aiTeams/agentStore';

function buildIssueDiscussionPrompt(
    owner: string,
    repo: string,
    issueNumber: number,
    issue: RepoIssue,
    comments: RepoIssueComment[],
): string {
    const url = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
    const labels = issue.labels?.length ? issue.labels.map((l) => l.name).join(', ') : '(none)';
    const body = issue.body?.trim() || '(no description)';
    const lines: string[] = [
        `GitHub Issue #${issueNumber}: ${issue.title}`,
        `Repo: ${owner}/${repo}`,
        `URL: ${url}`,
        `State: ${issue.state}`,
        `Author: @${issue.author} (${issue.createdAt})`,
        `Labels: ${labels}`,
        '',
        '--- Description ---',
        body,
    ];
    if (comments.length > 0) {
        lines.push('', `--- Comments (${comments.length}) ---`);
        for (const c of comments) {
            lines.push('', `[@${c.author} · ${c.createdAt}]`, c.body?.trim() || '(empty)');
        }
    }
    lines.push('', "Let's discuss this issue. What's your understanding and how would you approach it?");
    return lines.join('\n');
}

function IssueDetailScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const router = useRouter();
    const { owner, repo, number: numberStr, mockWorkId } = useLocalSearchParams<{ owner: string; repo: string; number: string; mockWorkId?: string }>();

    const { credentials } = useAuth();
    const issueNumber = parseInt(numberStr, 10);
    const aiTeamData = useManagedAiTeamData();
    const mockIssueData = mockWorkId ? getAiMockGithubIssue(mockWorkId) : null;
    const mockWork = mockWorkId ? findAiWorkItem(aiTeamData, mockWorkId) : undefined;
    const mockExecutions = mockWorkId ? findAiExecutionsForWork(aiTeamData, mockWorkId) : [];
    const [acceptanceStatus, setAcceptanceStatus] = React.useState<AiAcceptanceStatus>(mockWork?.acceptanceStatus ?? 'pending');
    const isMock = mockIssueData !== null;
    const githubIssue = useGithubIssue(owner!, repo!, issueNumber, !isMock);
    const githubComments = useGithubIssueComments(owner!, repo!, issueNumber, !isMock);
    const originalIssue = mockIssueData?.issue ?? githubIssue.data;
    const comments = mockIssueData?.comments ?? githubComments.data;
    const issueLoading = isMock ? false : githubIssue.loading;
    const mutateIssue = githubIssue.mutate;
    const linkedSessions = useLinkedSessions('github', `${owner}/${repo}#${issueNumber}`, 'issue');
    const navigateToSession = useNavigateToSession();

    const handleStartAiSession = React.useCallback(async () => {
        if (!originalIssue) return;
        if (isMock) {
            const latestSessionId = mockExecutions.find((execution) => execution.sessionId)?.sessionId;
            if (latestSessionId) navigateToSession(latestSessionId);
            return;
        }
        let githubToken: string | undefined;
        if (credentials && !isMock) {
            try {
                githubToken = await fetchGithubToken(credentials);
            } catch {
                // Proceed without GitHub MCP if token fetch fails
            }
        }
        const prompt = buildIssueDiscussionPrompt(owner!, repo!, issueNumber, originalIssue, comments);
        const dataId = storeTempData({
            prompt,
            sessionTitle: `Issue #${issueNumber}: ${originalIssue.title}`,
            sessionIcon: 'github',
            githubRepo: `${owner}/${repo}`,
            externalContext: {
                source: 'github',
                resourceType: 'issue',
                resourceId: `${owner}/${repo}#${issueNumber}`,
                title: originalIssue.title,
                deepLink: `/repos/${owner}/${repo}/issue/${issueNumber}${mockWorkId ? `?mockWorkId=${encodeURIComponent(mockWorkId)}` : ''}`,
            },
            ...(githubToken ? { environmentVariables: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken } } : {}),
        } satisfies NewSessionData);
        router.push(`/new?dataId=${dataId}`);
    }, [originalIssue, credentials, isMock, mockExecutions, comments, owner, repo, issueNumber, mockWorkId, router, navigateToSession]);

    React.useEffect(() => {
        setAcceptanceStatus(mockWork?.acceptanceStatus ?? 'pending');
    }, [mockWork?.id]);

    const approveDelivery = React.useCallback(() => {
        setAcceptanceStatus('approved');
        if (mockWork) saveManagedAiWorkItem({ ...mockWork, acceptanceStatus: 'approved', status: 'done', statusLabel: isZh ? '已完成' : 'Done' });
        const latestExecution = mockExecutions[0];
        if (latestExecution) {
            saveManagedAiExecution({ ...latestExecution, status: 'completed', statusLabel: isZh ? '已完成' : 'Completed', events: [...latestExecution.events, { id: `accepted-${Date.now()}`, kind: 'result', actor: 'human', title: isZh ? '真人验收通过' : 'Approved by human', timeLabel: isZh ? '刚刚' : 'Now', status: 'completed' }] });
            if (latestExecution.conversationId) {
                const timestamp = Date.now();
                appendManagedAiMessages(latestExecution.conversationId, [
                    { id: `accepted-user-${timestamp}`, kind: 'text', sender: 'user', text: isZh ? '这版可以，通过验收。' : 'This version looks good. Approved.', timeLabel: isZh ? '刚刚' : 'Now' },
                    { id: `accepted-agent-${timestamp + 1}`, kind: 'text', sender: 'agent', agentId: latestExecution.agentId, text: isZh ? '收到，这项工作就先完成了。有新的安排再发给我。' : 'Got it. I will mark this work complete. Send me the next item when it is ready.', timeLabel: isZh ? '刚刚' : 'Now' },
                ]);
            }
        }
        hapticsSuccess();
    }, [isZh, mockExecutions, mockWork]);

    const requestChanges = React.useCallback(async () => {
        const note = await Modal.prompt(
            isZh ? '需要调整' : 'Request changes',
            isZh ? '说明需要修改的内容，意见会回到对应会话。' : 'Describe what should change. The note will be sent back to the conversation.',
            { placeholder: isZh ? '例如：补充退出登录后的处理说明' : 'e.g. Clarify logout handling', confirmText: isZh ? '提交' : 'Submit' },
        );
        if (note === null) return;
        const body = note.trim() || (isZh ? '请根据验收结果继续调整。' : 'Continue based on the acceptance result.');
        setAcceptanceStatus('changes_requested');
        if (mockWork) saveManagedAiWorkItem({ ...mockWork, acceptanceStatus: 'changes_requested', status: 'working', statusLabel: isZh ? '调整中' : 'Revising' });
        const latestExecution = mockExecutions[0];
        if (latestExecution) {
            saveManagedAiExecution({ ...latestExecution, status: 'running', statusLabel: isZh ? '调整中' : 'Revising', events: [...latestExecution.events, { id: `changes-${Date.now()}`, kind: 'comment', actor: 'human', title: isZh ? '真人提出调整意见' : 'Changes requested', body, timeLabel: isZh ? '刚刚' : 'Now', status: 'running' }] });
            if (latestExecution.conversationId) appendManagedAiMessages(latestExecution.conversationId, [{ id: `changes-chat-${Date.now()}`, kind: 'text', sender: 'user', text: body, timeLabel: isZh ? '刚刚' : 'Now' }]);
        }
        hapticsLight();
    }, [isZh, mockExecutions, mockWork]);

    const insets = useSafeAreaInsets();
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [showAbsoluteTime, setShowAbsoluteTime] = React.useState(false);
    const scrollY = React.useRef(0);
    const [showHeaderSubtitle, setShowHeaderSubtitle] = React.useState(false);
    const subtitleOpacity = useSharedValue(0);
    const [displayedSubtitle, setDisplayedSubtitle] = React.useState('');

    const targetSubtitle = showHeaderSubtitle && originalIssue
        ? originalIssue.title
        : `${owner}/${repo}`;

    React.useEffect(() => {
        subtitleOpacity.value = withTiming(0, { duration: 100 });
        const timer = setTimeout(() => {
            setDisplayedSubtitle(targetSubtitle);
            subtitleOpacity.value = withTiming(1, { duration: 160 });
        }, 120);
        return () => clearTimeout(timer);
    }, [targetSubtitle]);

    const subtitleAnimStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));

    const handleScroll = React.useCallback((e: any) => {
        const y = e.nativeEvent.contentOffset.y;
        scrollY.current = y;
        setShowHeaderSubtitle(y > 60);
    }, []);

    const menuItems: ActionMenuItem[] = React.useMemo(() => {
        const isOpen = originalIssue?.state === 'open';
        const items: ActionMenuItem[] = [];
        if (!isMock) {
            items.push(
                {
                    label: t('repository.copyIssueUrl'),
                    onPress: () => {
                        Clipboard.setStringAsync(`https://github.com/${owner}/${repo}/issues/${issueNumber}`);
                        hapticsLight();
                    },
                },
                {
                    label: t('repository.openInGithub'),
                    onPress: () => {
                        WebBrowser.openBrowserAsync(`https://github.com/${owner}/${repo}/issues/${issueNumber}`);
                    },
                },
            );
        }
        items.push({
            label: t('repository.copyIssueNumber'),
            onPress: () => {
                Clipboard.setStringAsync(`#${issueNumber}`);
                hapticsLight();
            },
        });
        if (!isMock && originalIssue && credentials) {
            items.push({
                label: isOpen ? t('repository.closeIssue') : t('repository.reopenIssue'),
                destructive: isOpen,
                onPress: async () => {
                    const newState = isOpen ? 'closed' as const : 'open' as const;
                    mutateIssue((prev) => prev ? { ...prev, state: newState } : prev);
                    hapticsSuccess();
                    try {
                        await updateGithubIssue(credentials, owner!, repo!, issueNumber, { state: newState });
                    } catch {
                        mutateIssue((prev) => prev ? { ...prev, state: isOpen ? 'open' as const : 'closed' as const } : prev);
                        Modal.alert(t('issueComments.errorTitle'), t('repository.updateStateFailed'));
                    }
                },
            });
        }
        return items;
    }, [owner, repo, issueNumber, originalIssue, credentials, isMock, mutateIssue]);

    const headerTitle = React.useCallback(() => (
        <Pressable style={{ alignItems: 'center', justifyContent: 'center', maxWidth: 220 }}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.colors.header.tint }]}>
                #{originalIssue?.number ?? numberStr}
            </Text>
            <Animated.Text
                numberOfLines={1}
                style={[styles.headerSubtitle, { color: theme.colors.textSecondary }, subtitleAnimStyle]}
            >
                {displayedSubtitle}
            </Animated.Text>
        </Pressable>
    ), [originalIssue?.number, numberStr, theme.colors.header.tint, theme.colors.textSecondary, displayedSubtitle, subtitleAnimStyle]);

    const headerRight = React.useCallback(() => (
        <Pressable
            onPress={() => setMenuVisible(true)}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
        </Pressable>
    ), [theme.colors.header.tint]);

    if (issueLoading) {
        return (
            <View style={styles.container}>
                <Stack.Screen
                    options={{
                        headerTitle: () => (
                            <View style={{ alignItems: 'center', maxWidth: 220 }}>
                                <Text style={styles.headerTitle}>#{numberStr}</Text>
                                <Text style={[styles.headerSubtitle, { opacity: 1 }]} numberOfLines={1}>
                                    {owner}/{repo}
                                </Text>
                            </View>
                        ),
                        headerRight: () => (
                            <Pressable
                                onPress={() => setMenuVisible(true)}
                                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                            >
                                <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                            </Pressable>
                        ),
                    }}
                />
                <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]} style={{ backgroundColor: theme.colors.surface }}>
                    <ShimmerView>
                        <SkeletonBlock w={'85%'} h={22} radius={4} />
                        <SkeletonBlock w={'60%'} h={22} radius={4} mt={6} />
                        <View style={{ gap: 14, marginTop: 20 }}>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <SkeletonBlock w={68} h={24} radius={999} />
                            </View>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <View style={styles.fieldValueRow}>
                                    <SkeletonBlock w={20} h={20} radius={10} />
                                    <SkeletonBlock w={80} h={14} radius={3} />
                                </View>
                            </View>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <SkeletonBlock w={80} h={14} radius={3} />
                            </View>
                        </View>
                        <View style={[styles.sectionDivider, { marginTop: 16 }]} />
                        <View style={{ gap: 6, marginTop: 16 }}>
                            <SkeletonBlock w={90} h={14} radius={3} />
                            <SkeletonBlock w={'95%'} h={14} radius={3} />
                            <SkeletonBlock w={'88%'} h={14} radius={3} />
                            <SkeletonBlock w={'70%'} h={14} radius={3} />
                        </View>
                    </ShimmerView>
                </ScrollView>
            </View>
        );
    }

    if (!originalIssue) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: `Issue #${numberStr}` }} />
                <RepoEmptyState
                    iconElement={<IssueIcon size={24} color={theme.colors.textSecondary} />}
                    title={t('lab.issueNotFound')}
                />
            </View>
        );
    }

    const issue = originalIssue;
    const isOpen = issue.state === 'open';
    const commentsPath = `/repos/${owner}/${repo}/issue/${issueNumber}/comments?issueTitle=${encodeURIComponent(issue.title)}&issueAuthor=${encodeURIComponent(issue.author)}${mockWorkId ? `&mockWorkId=${encodeURIComponent(mockWorkId)}` : ''}`;

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    headerTitle,
                    headerRight,
                }}
            />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]} style={{ backgroundColor: theme.colors.surface }} onScroll={handleScroll} scrollEventThrottle={16}>
                {/* Title */}
                <Text style={styles.issueTitle}>{issue.title}</Text>

                {/* Fields */}
                <View style={styles.fieldGroup}>
                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>{t('repository.issueStatus')}</Text>
                        <StatePill state={isOpen ? 'open' : 'closed'} size="md" />
                    </View>
                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>{t('repository.issueAuthor')}</Text>
                        <View style={styles.fieldValueRow}>
                            <Avatar id={issue.author} size={20} imageUrl={issue.authorAvatarUrl} />
                            <Text style={styles.fieldValue}>{issue.author}</Text>
                        </View>
                    </View>
                    {issue.labels.length > 0 && (
                        <View style={styles.field}>
                            <Text style={styles.fieldLabel}>{t('repository.issueLabels')}</Text>
                            <View style={styles.labelsRow}>
                                {issue.labels.map((label) => {
                                    const lc = labelColors(label.color);
                                    return (
                                        <View
                                            key={label.name}
                                            style={[styles.labelPill, { backgroundColor: lc.bg }]}
                                        >
                                            <Text style={[styles.labelText, { color: lc.text }]}>
                                                {label.name}
                                            </Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    )}
                    <Pressable style={styles.field} onPress={() => setShowAbsoluteTime((v) => !v)}>
                        <Text style={styles.fieldLabel}>{t('repository.issueCreated')}</Text>
                        <Text style={styles.fieldValueSecondary}>
                            {showAbsoluteTime ? formatAbsoluteTime(issue.createdAt) : formatTimeAgo(issue.createdAt)}
                        </Text>
                    </Pressable>
                </View>

                <View style={styles.sectionDivider} />

                {/* Description */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('repository.issueDescription')}</Text>
                    {issue.body ? (
                        <MarkdownView markdown={issue.body} hideOptions />
                    ) : (
                        <Text style={styles.bodyEmpty}>{t('repository.noDescription')}</Text>
                    )}
                </View>

                {mockIssueData && (
                    <>
                        <View style={styles.sectionDivider} />
                        <View style={styles.activitySection}>
                            <MockIssueExecutionLog
                                executions={mockExecutions}
                                onOpenExecution={(executionId) => router.push(`/inbox/ai/executions/${executionId}` as never)}
                            />
                        </View>
                        {mockWork?.acceptanceStatus ? (
                            <>
                                <View style={styles.sectionDivider} />
                                <View style={styles.acceptanceSection}>
                                    <View style={styles.acceptanceHeader}>
                                        <View>
                                            <Text style={styles.sectionTitle}>{isZh ? '真人验收' : 'Human acceptance'}</Text>
                                            <Text style={styles.acceptanceHint}>
                                                {acceptanceStatus === 'approved'
                                                    ? (isZh ? '你已确认本次交付。' : 'You approved this delivery.')
                                                    : acceptanceStatus === 'changes_requested'
                                                        ? (isZh ? '已退回调整，Agent 可根据意见继续执行。' : 'Returned for changes. The agent can continue from your feedback.')
                                                        : (isZh ? 'Agent 已提交结果，等待你最终确认。' : 'The agent submitted results and is waiting for your decision.')}
                                            </Text>
                                        </View>
                                        <View style={[styles.acceptanceStatus, acceptanceStatus === 'approved' && styles.acceptanceApproved, acceptanceStatus === 'changes_requested' && styles.acceptanceChanges]}>
                                            <Text style={styles.acceptanceStatusText}>{acceptanceStatus === 'approved' ? (isZh ? '已通过' : 'Approved') : acceptanceStatus === 'changes_requested' ? (isZh ? '需要调整' : 'Changes requested') : (isZh ? '等待验收' : 'Pending')}</Text>
                                        </View>
                                    </View>
                                    {acceptanceStatus === 'pending' ? (
                                        <View style={styles.acceptanceActions}>
                                            <Pressable style={styles.acceptanceSecondary} onPress={requestChanges}><Text style={styles.acceptanceSecondaryText}>{isZh ? '需要调整' : 'Request changes'}</Text></Pressable>
                                            <Pressable style={styles.acceptancePrimary} onPress={approveDelivery}><Ionicons name="checkmark" size={16} color={theme.colors.button.primary.tint} /><Text style={styles.acceptancePrimaryText}>{isZh ? '通过' : 'Approve'}</Text></Pressable>
                                        </View>
                                    ) : null}
                                </View>
                            </>
                        ) : null}
                        <View style={styles.sectionDivider} />
                        <View style={styles.activitySection}>
                            <View style={styles.activityHeader}>
                                <Text style={styles.sectionTitle}>{isZh ? '动态' : 'Activity'}</Text>
                            </View>
                            <MockIssueActivityTimeline
                                entries={mockIssueData.timeline}
                                comments={comments}
                                onOpenComments={() => router.push(commentsPath as never)}
                            />
                        </View>
                    </>
                )}

                {linkedSessions.length > 0 && (
                    <>
                        <View style={styles.sectionDivider} />
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                {t('github.relatedSessions')} ({linkedSessions.length})
                            </Text>
                            {linkedSessions.map((session) => (
                                <Pressable
                                    key={session.id}
                                    style={[styles.sessionCard, { backgroundColor: theme.colors.surface }]}
                                    onPress={() => navigateToSession(session.id)}
                                >
                                    <Text style={[styles.sessionTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                        {getSessionName(session)}
                                    </Text>
                                    <Text style={[styles.sessionMeta, { color: theme.colors.textSecondary }]}>
                                        {[
                                            session.metadata?.flavor || 'claude',
                                            session.metadata?.host,
                                            formatSessionAge(session.createdAt),
                                        ].filter(Boolean).join(' · ')}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </>
                )}

            </ScrollView>
            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Pressable
                    style={[styles.btnChat, { borderColor: theme.colors.divider }]}
                    onPress={() => router.push(commentsPath as never)}
                >
                    <View style={styles.bottomButtonInner}>
                        <Ionicons name="chatbubbles-outline" size={17} color={theme.colors.text} />
                        <Text style={[styles.bottomButtonText, { color: theme.colors.text }]} numberOfLines={1}>
                            {comments.length > 0 ? `${t('issueComments.title')} (${comments.length})` : t('issueComments.title')}
                        </Text>
                    </View>
                </Pressable>
                <Pressable
                    style={[styles.btnPilot, { backgroundColor: theme.colors.button.primary.background }]}
                    onPress={handleStartAiSession}
                >
                    <View style={styles.bottomButtonInner}>
                        <Ionicons name="sparkles" size={17} color={theme.colors.button.primary.tint} />
                        <Text style={[styles.bottomButtonText, { color: theme.colors.button.primary.tint }]} numberOfLines={1}>
                            {isMock ? (isZh ? '打开最近 Session' : 'Open latest session') : t('issueDetail.aiSession')}
                        </Text>
                    </View>
                </Pressable>
            </View>
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
                deferItemPress
            />
        </View>
    );
}

export default React.memo(IssueDetailScreen);

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
        gap: 16,
    },
    issueTitle: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        lineHeight: 26,
    },
    fieldGroup: {
        gap: 12,
    },
    field: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    fieldLabel: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        flexShrink: 0,
        marginRight: 12,
    },
    fieldValue: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    fieldValueSecondary: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    fieldValueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    sectionDivider: {
        height: 1,
        backgroundColor: theme.colors.divider,
    },
    section: {
        gap: 6,
    },
    acceptanceSection: { gap: 14 },
    acceptanceHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
    acceptanceHint: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 520 },
    acceptanceStatus: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: theme.colors.surfaceHigh },
    acceptanceApproved: { backgroundColor: '#E8F7ED' },
    acceptanceChanges: { backgroundColor: '#FFF3E5' },
    acceptanceStatusText: { ...Typography.default('semiBold'), color: theme.colors.textSecondary, fontSize: 12 },
    acceptanceActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
    acceptanceSecondary: { minHeight: 38, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' },
    acceptanceSecondaryText: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13 },
    acceptancePrimary: { minHeight: 38, paddingHorizontal: 15, borderRadius: 9, backgroundColor: theme.colors.button.primary.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
    acceptancePrimaryText: { ...Typography.default('semiBold'), color: theme.colors.button.primary.tint, fontSize: 13 },
    activitySection: {
        gap: 12,
    },
    activityHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    bodyEmpty: {
        fontSize: 15,
        fontStyle: 'italic',
        color: theme.colors.textSecondary,
        lineHeight: 22,
        ...Typography.default('regular'),
    },
    labelsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        justifyContent: 'flex-end',
        flex: 1,
    },
    labelPill: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
    },
    labelText: {
        fontSize: 12,
        fontWeight: '600',
    },
    bottomBar: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    btnChat: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    btnPilot: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    bottomButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        flexShrink: 1,
    },
    sessionCard: {
        paddingVertical: 10,
        gap: 2,
    },
    sessionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    sessionMeta: {
        ...Typography.default(),
        fontSize: 12,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    headerSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 16,
        marginTop: -2,
        color: theme.colors.textSecondary,
    },
}));

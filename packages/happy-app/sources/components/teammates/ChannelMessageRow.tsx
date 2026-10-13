import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { ChannelMessageBody, Teammate, TeammateTask } from 'happy-wire';
import type { StoredChannelMessage } from '@/sync/channelReducers';
import { channelMentionLinks } from '@/sync/channelDecisions';
import { channelSystemMessage, governanceSystemMessage } from '@/sync/channelSystemMessage';
import { storage, useSession } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { useGithubIssue, useGithubPull } from '@/hooks/useGithubData';
import { getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { StatusDot } from '@/components/StatusDot';
import { GitHubOcticon } from '@/components/repos/GitHubOcticon';
import { PullRequestIcon } from '@/components/repos/PullRequestIcon';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { channelGithubReference, channelLinkSource, channelTime, githubLinkState } from './channelMessageLayout';
import { TeammateAvatar, teammateColor } from './ui';

export type ChannelLink = NonNullable<ChannelMessageBody['links']>[number];

const AVATAR_SIZE = 36;
const AVATAR_GAP = 10;

const LINK_ICONS: Record<ChannelLink['kind'], React.ComponentProps<typeof Ionicons>['name']> = {
    session: 'terminal-outline',
    pr: 'git-pull-request-outline',
    issue: 'radio-button-on-outline',
    url: 'link-outline',
};

/** A link as a DooTask file card: an icon circle, its name, and a line saying what and where it is. */
function LinkCardView({ icon, tint, title, detail, label, onPress }: {
    icon: React.ReactNode;
    /** The state color the icon circle is filled with, as GitHub fills its state badges; neutral without one. */
    tint?: string;
    title: string;
    detail: React.ReactNode;
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
            <View style={[styles.linkIcon, tint ? { backgroundColor: tint } : null]}>{icon}</View>
            <View style={styles.linkInfo}>
                <Text style={styles.linkTitle} numberOfLines={1}>{title}</Text>
                {detail ? <Text style={styles.linkDetail} numberOfLines={1}>{detail}</Text> : null}
            </View>
        </Pressable>
    );
}

/** A GitHub PR or issue in GitHub's own state colors and icons, read live so a merged PR shows as merged. */
function GithubLinkCard({ link, reference, onPress }: { link: ChannelLink; reference: { owner: string; repo: string; number: number }; onPress: () => void }) {
    const { theme } = useUnistyles();
    const pull = useGithubPull(reference.owner, reference.repo, link.kind === 'pr' ? reference.number : 0).data;
    const issue = useGithubIssue(reference.owner, reference.repo, link.kind === 'issue' ? reference.number : 0).data;
    const item = link.kind === 'pr' ? pull : issue;
    const state = githubLinkState(item);
    const color = state === 'open' ? theme.colors.repo.stateOpen
        : state === 'merged' ? theme.colors.repo.stateMerged
        : state === 'closed' ? (link.kind === 'pr' ? theme.colors.repo.stateClosedPull : theme.colors.repo.stateClosed)
        : state ? theme.colors.repo.stateDraft
        : theme.colors.textSecondary;
    // White on the filled circle once the state is known, gray on the neutral one until then.
    const iconColor = state ? '#FFFFFF' : theme.colors.textSecondary;
    const icon = link.kind === 'pr'
        ? <PullRequestIcon state={state === 'notPlanned' ? 'closed' : state ?? 'open'} size={16} color={iconColor} />
        : <GitHubOcticon name={state === 'closed' ? 'issue-closed' : state === 'notPlanned' ? 'skip' : 'issue-opened'} size={16} color={iconColor} />;
    const kind = t(`channels.linkKinds.${link.kind}`);
    const number = `#${reference.number}`;
    const name = item?.title || link.title;
    const where = `${reference.owner}/${reference.repo}${name ? ` ${number}` : ''}`;
    const stateLabel = state ? t(`channels.linkStates.${state}`) : null;
    return (
        <LinkCardView
            icon={icon}
            tint={state ? color : undefined}
            title={name || `${kind} ${number}`}
            detail={<>{stateLabel ? <Text style={[styles.linkState, { color }]}>{stateLabel}</Text> : kind} · {where}</>}
            label={[kind, name || number, stateLabel].filter(Boolean).join(', ')}
            onPress={onPress}
        />
    );
}

/** A session with the same status dot and text the session list gives it. */
function SessionLinkCard({ link, session, onPress }: { link: ChannelLink; session: Session; onPress: () => void }) {
    const { theme } = useUnistyles();
    const status = useSessionStatus(session);
    const kind = t('channels.linkKinds.session');
    const title = link.title || getSessionName(session);
    return (
        <LinkCardView
            icon={(
                <>
                    <Ionicons name="terminal-outline" size={16} color={theme.colors.textSecondary} />
                    <View style={styles.linkDot}><StatusDot color={status.statusDotColor} isPulsing={status.isPulsing} size={8} /></View>
                </>
            )}
            title={title}
            detail={`${kind} · ${status.statusText}`}
            label={`${kind}: ${title}, ${status.statusText}`}
            onPress={onPress}
        />
    );
}

function LinkCard({ link, onPress }: { link: ChannelLink; onPress: () => void }) {
    const { theme } = useUnistyles();
    const session = useSession(link.kind === 'session' ? link.sessionId ?? '' : '');
    const github = channelGithubReference(link);
    if (github) return <GithubLinkCard link={link} reference={github} onPress={onPress} />;
    if (session) return <SessionLinkCard link={link} session={session} onPress={onPress} />;
    const kind = t(`channels.linkKinds.${link.kind}`);
    const { source } = channelLinkSource(link);
    const title = link.title || (link.kind === 'url' ? link.url : null) || kind;
    const detail = [title === kind ? null : kind, source].filter(Boolean).join(' · ');
    return (
        <LinkCardView
            icon={<Ionicons name={LINK_ICONS[link.kind]} size={16} color={theme.colors.textSecondary} />}
            title={title}
            detail={detail}
            label={`${kind}: ${title}`}
            onPress={onPress}
        />
    );
}

/**
 * One channel message, laid out like a DooTask chat bubble: Agents get a Slack-style flat row with
 * the avatar and a colored name on the first row of a run, the user's own messages a right-aligned band.
 */
export const ChannelMessageRow = React.memo(({ message, header, sender, members, showReport, task, choice, busy, onDecide, onRetry, onRetryRun, onOpenTask, onOpenLink }: {
    message: StoredChannelMessage;
    header: boolean;
    sender?: Teammate;
    /** Agents whose @handles in the text become links to their profiles. */
    members?: Teammate[];
    /** Whether a report message carries its Report tag; a private chat is all reports, so it hides it. */
    showReport: boolean;
    /** The task this message is about, once loaded; until then its tag only says "Task". */
    task?: TeammateTask;
    /** The option already picked when this is a decision. */
    choice?: string;
    busy: boolean;
    onDecide: (message: StoredChannelMessage, label: string) => void;
    onRetry: (message: StoredChannelMessage) => void;
    onRetryRun: (runId: string) => void;
    onOpenTask: (taskId: string) => void;
    onOpenLink: (link: ChannelLink) => void;
}) => {
    const { theme } = useUnistyles();

    if (message.content.t === 'system') {
        const governance = governanceSystemMessage(message.content);
        const channelSystem = channelSystemMessage(message.content, id => storage.getState().teammates[id]?.name);
        const label = governance?.code === 'budget_warning' ? t('channels.system.budget_warning', governance)
            : governance?.code === 'task_self_assigned' ? t('channels.system.task_self_assigned', { ...governance, agent: governance.agent || t('channels.unknownAgent') })
            : governance?.code === 'run_failed' ? t('channels.system.run_failed', { name: governance.name || t('channels.unknownAgent'), reason: t(`teammates.failure.${governance.reason}`) })
            : channelSystem?.code === 'member_added' && channelSystem.names.length ? t('channels.system.memberAddedNamed', { names: channelSystem.names.join(', ') })
            : channelSystem?.code === 'member_removed' && channelSystem.names.length ? t('channels.system.memberRemovedNamed', { names: channelSystem.names.join(', ') })
            : channelSystem?.code === 'title_changed' ? t('channels.system.title_changed', { title: channelSystem.title })
            : channelSystem?.code === 'brief_changed' && channelSystem.cleared ? t('channels.system.briefCleared')
            : t(`channels.system.${message.content.code}`);
        const taskId = governance?.code === 'task_self_assigned' ? governance.taskId : undefined;
        const runId = governance?.code === 'run_failed' ? governance.runId : null;
        return (
            <View style={styles.notice}>
                {runId ? (
                    <View style={styles.noticeLinkRow}>
                        <Ionicons name="alert-circle-outline" size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.noticeText}>{label}</Text>
                        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onRetryRun(runId)} hitSlop={8}>
                            <Text style={styles.retryText}>{t('common.retry')}</Text>
                        </Pressable>
                    </View>
                ) : taskId ? (
                    <Pressable accessibilityRole="link" onPress={() => onOpenTask(taskId)} hitSlop={6} style={styles.noticeLinkRow}>
                        <Text style={[styles.noticeText, styles.noticeLink]}>{label}</Text>
                        <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                    </Pressable>
                ) : (
                    <Text style={styles.noticeText}>{label}</Text>
                )}
            </View>
        );
    }

    const taskId = message.taskId;
    const isReport = showReport && message.kind === 'report';
    const tags = isReport || taskId ? (
        <View style={styles.tags}>
            {isReport && (
                <View style={styles.tag}>
                    <Ionicons name="document-text-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={styles.tagText}>{t('channels.report')}</Text>
                </View>
            )}
            {taskId && (
                <Pressable accessibilityRole="link" onPress={() => onOpenTask(taskId)} style={({ pressed }) => [styles.tag, styles.taskTag, pressed && styles.pressed]} hitSlop={6}>
                    <Ionicons name="checkbox-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={[styles.tagText, styles.taskTitle]} numberOfLines={1}>{task?.title || t('teammateTasks.tag')}</Text>
                    {task && <Text style={styles.tagText}>· {t(`teammates.taskStatus.${task.status}`)}</Text>}
                    <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                </Pressable>
            )}
        </View>
    ) : null;
    const body = message.body
        ? <View style={styles.body}><MarkdownView markdown={members ? channelMentionLinks(message.body.text, members) : message.body.text} hideOptions /></View>
        : <Text style={styles.error}>{t('channels.decryptError')}</Text>;

    if (message.senderType === 'user') {
        return (
            <View style={[styles.selfBand, message.delivery === 'failed' && styles.failedBand]}>
                <View style={styles.selfContent}>
                    {tags}
                    {body}
                    {message.delivery === 'pending' ? (
                        <View style={styles.statusRow}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.spinner} />
                            <Text style={styles.statusText}>{t('channels.sending')}</Text>
                        </View>
                    ) : message.delivery === 'failed' ? (
                        <View style={styles.statusRow}>
                            <Ionicons name="alert-circle" size={13} color={theme.colors.textDestructive} />
                            <Text style={[styles.statusText, styles.failedText]}>{t('channels.sendFailed')}</Text>
                            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onRetry(message)} hitSlop={8}>
                                <Text style={styles.retryText}>{t('common.retry')}</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <Text style={styles.selfTime}>{channelTime(message.createdAt)}</Text>
                    )}
                </View>
            </View>
        );
    }

    const options = message.kind === 'decision' ? message.body?.options ?? [] : [];
    const links = message.body?.links ?? [];
    return (
        <View style={styles.otherRow}>
            <View style={styles.avatarColumn}>
                {header && <TeammateAvatar teammate={sender ?? { avatar: null }} size={AVATAR_SIZE} />}
            </View>
            <View style={styles.otherContent}>
                {header && (
                    <View style={styles.headerRow}>
                        <Text style={[styles.senderName, { color: teammateColor(sender, theme.colors.text) }]} numberOfLines={1}>
                            {sender?.name || t('channels.unknownAgent')}
                        </Text>
                        <Text style={styles.headerTime}>{channelTime(message.createdAt)}</Text>
                    </View>
                )}
                {tags}
                {body}
                {options.length > 0 && (
                    <View style={styles.options}>
                        {options.map(option => {
                            const chosen = choice === option.id;
                            const disabled = busy || !!choice;
                            return (
                                <Pressable
                                    key={option.id}
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled, selected: chosen }}
                                    disabled={disabled}
                                    onPress={() => onDecide(message, option.label)}
                                    style={[styles.option, chosen && styles.optionChosen, disabled && !chosen && styles.optionDisabled]}
                                >
                                    {chosen && <Ionicons name="checkmark" size={14} color={theme.colors.button.primary.tint} />}
                                    <Text style={[styles.optionText, chosen && styles.optionTextChosen]}>{option.label}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                {links.length > 0 && (
                    <View style={styles.links}>
                        {links.map((link, index) => <LinkCard key={index} link={link} onPress={() => onOpenLink(link)} />)}
                    </View>
                )}
            </View>
        </View>
    );
});

function TypingDot({ delay }: { delay: number }) {
    const progress = useSharedValue(0);
    React.useEffect(() => {
        progress.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 350 }), withTiming(0, { duration: 350 }), withTiming(0, { duration: 300 })), -1));
        return () => cancelAnimation(progress);
    }, [delay, progress]);
    const animated = useAnimatedStyle(() => ({ opacity: 0.3 + progress.value * 0.7, transform: [{ translateY: -3 * progress.value }] }));
    return <Animated.View style={[styles.typingDot, animated]} />;
}

/** An Agent that is answering right now, shown at the end of the chat as its own message: avatar, name and bouncing dots. */
export const ChannelWorkingRow = React.memo(({ teammate }: { teammate: Teammate }) => {
    const { theme } = useUnistyles();
    return (
        <View accessibilityLabel={t('teammates.working')} style={[styles.otherRow, styles.workingRow]}>
            <View style={styles.avatarColumn}>
                <TeammateAvatar teammate={teammate} size={AVATAR_SIZE} />
            </View>
            <View style={styles.otherContent}>
                <View style={styles.headerRow}>
                    <Text style={[styles.senderName, { color: teammateColor(teammate, theme.colors.text) }]} numberOfLines={1}>{teammate.name}</Text>
                </View>
                <View style={styles.typing}>
                    <TypingDot delay={0} />
                    <TypingDot delay={150} />
                    <TypingDot delay={300} />
                </View>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    workingRow: {
        marginTop: 22,
    },
    typing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 22,
    },
    typingDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: theme.colors.textSecondary,
    },
    notice: {
        alignItems: 'center',
        paddingVertical: theme.margins.sm,
        paddingHorizontal: theme.margins.lg,
    },
    noticeText: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 12,
        textAlign: 'center',
        color: theme.colors.textSecondary,
    },
    noticeLinkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    noticeLink: {
        textDecorationLine: 'underline',
    },
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
    },
    otherContent: {
        flex: 1,
        minWidth: 0,
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
    headerTime: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 18,
        flexShrink: 0,
        color: theme.colors.textSecondary,
    },
    selfBand: {
        paddingVertical: theme.margins.sm,
        paddingLeft: AVATAR_SIZE + AVATAR_GAP + theme.margins.lg,
        paddingRight: theme.margins.lg,
        backgroundColor: theme.colors.surfaceHigh,
    },
    failedBand: {
        opacity: 0.7,
    },
    selfContent: {
        alignItems: 'flex-end',
        width: '100%',
        minWidth: 0,
    },
    selfTime: {
        ...Typography.default(),
        fontSize: 11,
        marginTop: 2,
        color: theme.colors.textSecondary,
    },
    body: {
        maxWidth: '100%',
    },
    error: {
        ...Typography.default('italic'),
        fontSize: 13,
        color: theme.colors.textDestructive,
    },
    tags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: theme.margins.xs,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    tagText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    taskTag: {
        maxWidth: '100%',
    },
    taskTitle: {
        color: theme.colors.text,
        flexShrink: 1,
    },
    pressed: {
        opacity: 0.6,
    },
    options: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.margins.sm,
        marginTop: theme.margins.sm,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 32,
        paddingHorizontal: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    optionChosen: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    optionDisabled: {
        opacity: 0.45,
    },
    optionText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    optionTextChosen: {
        color: theme.colors.button.primary.tint,
    },
    links: {
        gap: 6,
        marginTop: theme.margins.sm,
        alignItems: 'flex-start',
    },
    linkCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
        width: 300,
        maxWidth: '100%',
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.sm,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.surfaceHigh,
    },
    linkIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    linkInfo: {
        flex: 1,
        minWidth: 0,
    },
    linkTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    linkDetail: {
        ...Typography.default(),
        fontSize: 12,
        marginTop: 1,
        color: theme.colors.textSecondary,
    },
    linkState: {
        ...Typography.default('semiBold'),
    },
    linkDot: {
        position: 'absolute',
        right: -1,
        bottom: -1,
        padding: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceHigh,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    spinner: {
        width: 12,
        height: 12,
        transform: [{ scale: 0.6 }],
    },
    statusText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    failedText: {
        color: theme.colors.textDestructive,
    },
    retryText: {
        ...Typography.default('semiBold'),
        fontSize: 11,
        marginLeft: 4,
        color: theme.colors.textLink,
    },
}));

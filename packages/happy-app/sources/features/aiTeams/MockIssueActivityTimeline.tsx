import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import type { RepoIssueComment } from '@/data/mockRepos';
import type { AiMockIssueTimelineEntry } from './mockGithubIssues';
import { getCurrentLanguage } from '@/text';

type ActivityEntry = Extract<AiMockIssueTimelineEntry, { type: 'activity' }>;
type CommentEntry = Extract<AiMockIssueTimelineEntry, { type: 'comment' }>;
type TimelineGroup =
    | { id: string; type: 'activities'; entries: ActivityEntry[] }
    | { id: string; type: 'comment'; entry: CommentEntry };

type Props = {
    entries: AiMockIssueTimelineEntry[];
    comments: RepoIssueComment[];
    onOpenComments: () => void;
};

function activityIcon(action: ActivityEntry['action']): React.ComponentProps<typeof Ionicons>['name'] {
    switch (action) {
        case 'created': return 'add-circle-outline';
        case 'assigned': return 'person-add-outline';
        case 'status_changed': return 'swap-horizontal-outline';
        case 'execution_started': return 'play-circle-outline';
        case 'execution_completed': return 'checkmark-circle-outline';
        case 'execution_failed': return 'close-circle-outline';
        case 'human_decision_required': return 'help-circle-outline';
    }
}

function activityColor(action: ActivityEntry['action'], theme: ReturnType<typeof useUnistyles>['theme']): string {
    switch (action) {
        case 'execution_completed': return theme.colors.success;
        case 'execution_failed': return theme.colors.textDestructive;
        case 'human_decision_required': return theme.colors.warning;
        default: return theme.colors.textSecondary;
    }
}

function splitAiName(name: string): { name: string; isAi: boolean } {
    const isAi = name.endsWith(' [AI]');
    return { name: isAi ? name.slice(0, -5) : name, isAi };
}

function groupTimeline(entries: AiMockIssueTimelineEntry[]): TimelineGroup[] {
    const groups: TimelineGroup[] = [];
    for (const entry of entries) {
        if (entry.type === 'activity') {
            const previous = groups[groups.length - 1];
            if (previous?.type === 'activities') {
                previous.entries.push(entry);
            } else {
                groups.push({ id: `activities-${entry.id}`, type: 'activities', entries: [entry] });
            }
        } else if (entry.type === 'comment') {
            groups.push({ id: entry.id, type: 'comment', entry });
        }
    }
    return groups;
}

export function MockIssueActivityTimeline({ entries, comments, onOpenComments }: Props) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const isChinese = getCurrentLanguage().startsWith('zh');
    const groups = React.useMemo(() => groupTimeline(entries), [entries]);
    const commentsById = React.useMemo(() => new Map(comments.map((comment) => [comment.id, comment])), [comments]);
    const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(() => new Set(groups.filter((group) => group.type === 'activities').map((group) => group.id)));

    React.useEffect(() => {
        setExpandedGroups(new Set(groups.filter((group) => group.type === 'activities').map((group) => group.id)));
    }, [entries]);

    const toggleGroup = React.useCallback((id: string) => {
        setExpandedGroups((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    return (
        <View style={styles.timeline}>
            {groups.map((group) => {
                if (group.type === 'activities') {
                    const expanded = expandedGroups.has(group.id);
                    return (
                        <View key={group.id} style={styles.activityGroup}>
                            <Pressable style={styles.groupHeader} onPress={() => toggleGroup(group.id)}>
                                <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={theme.colors.textSecondary} />
                                <Text style={styles.groupLabel}>
                                    {isChinese ? `${group.entries.length} 项动态` : `${group.entries.length} ${group.entries.length === 1 ? 'activity' : 'activities'}`}
                                </Text>
                            </Pressable>
                            {expanded && group.entries.map((entry) => (
                                <View key={entry.id} style={styles.activityRow}>
                                    <View style={styles.activityIcon}>
                                        <Ionicons name={activityIcon(entry.action)} size={17} color={activityColor(entry.action, theme)} />
                                    </View>
                                    <Text style={styles.activityText} numberOfLines={1}>
                                        <Text style={styles.activityActor}>{entry.actorName}</Text>
                                        {entry.actorType === 'agent' && <Text style={styles.aiText}> AI</Text>}
                                        <Text style={styles.activityText}> {entry.summary}</Text>
                                    </Text>
                                    <Text style={styles.time}>{entry.timeLabel}</Text>
                                </View>
                            ))}
                        </View>
                    );
                }

                if (group.type === 'comment') {
                    const comment = commentsById.get(group.entry.commentId);
                    if (!comment) return null;
                    const author = splitAiName(comment.author);
                    return (
                        <Pressable key={group.id} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onOpenComments}>
                            <Avatar id={comment.author} size={28} imageUrl={comment.authorAvatarUrl} />
                            <View style={styles.cardContent}>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.cardAuthor}>{author.name}</Text>
                                    {author.isAi && <Text style={styles.aiText}>AI</Text>}
                                    <Text style={styles.cardTime}>{group.entry.timeLabel}</Text>
                                </View>
                                <Text style={styles.cardSummary} numberOfLines={1}>{comment.body}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
                        </Pressable>
                    );
                }

            })}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    timeline: { gap: 12 },
    activityGroup: { gap: 5 },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 28 },
    groupLabel: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13 },
    activityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 29, paddingLeft: 28 },
    activityIcon: { width: 18, alignItems: 'center', justifyContent: 'center' },
    activityText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },
    activityActor: { ...Typography.default('semiBold'), color: theme.colors.textSecondary, fontSize: 13 },
    aiText: { ...Typography.default('semiBold'), color: theme.colors.textLink, fontSize: 9, letterSpacing: 0.3, flexShrink: 0 },
    time: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flexShrink: 0 },
    card: {
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 13,
        paddingVertical: 11,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    cardContent: { flex: 1, minWidth: 0, gap: 3 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardAuthor: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 14, flexShrink: 0 },
    cardTime: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto', flexShrink: 0 },
    cardSummary: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, minWidth: 0 },
    pressed: { opacity: 0.65 },
}));

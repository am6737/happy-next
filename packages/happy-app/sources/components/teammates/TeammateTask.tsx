import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { TeammateRun, TeammateTaskStatus } from 'happy-wire';
import { useTeammateTask } from '@/hooks/useTeammateTask';
import { useTickingNow } from '@/hooks/useTickingNow';
import { storage } from '@/sync/storage';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { formatLastSeen } from '@/utils/sessionUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StatusDot } from './kit';
import { TeammateAvatar } from './ui';

/** `mm:ss`, or `h:mm:ss` from an hour on. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const clock = `${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    return hours ? `${hours}:${clock}` : clock;
}

export function useTaskStatusColor(status: TeammateTaskStatus): string {
    const { theme } = useUnistyles();
    switch (status) {
        case 'in_progress': return theme.colors.status.connecting;
        case 'awaiting_input':
        case 'in_review':
        case 'paused': return theme.colors.box.warning.text;
        case 'done': return theme.colors.status.connected;
        default: return theme.colors.textSecondary;
    }
}

export function useRunStatusColor(status: TeammateRun['status']): string {
    const { theme } = useUnistyles();
    switch (status) {
        case 'dispatching':
        case 'running': return theme.colors.status.connecting;
        case 'completed': return theme.colors.status.connected;
        case 'failed': return theme.colors.status.error;
        default: return theme.colors.textSecondary;
    }
}

/**
 * Summary of one delegated task for the issue page: who has it, its status and latest progress, and how long
 * the current run has been going. The whole card opens the task.
 */
export const TeammateTaskCard = React.memo(function TeammateTaskCard({ id }: { id: string }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const detail = useTeammateTask(id);
    const teammate = storage(state => detail ? state.teammates[detail.task.teammateId] : undefined);
    const statusColor = useTaskStatusColor(detail?.task.status ?? 'todo');
    const liveRun = detail?.runs.filter(isTeammateRunCancellable).sort((a, b) => b.queuedAt - a.queuedAt)[0];
    const now = useTickingNow(!!liveRun);
    if (!detail) return null;
    const { task } = detail;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={task.title} onPress={() => router.push(`/teammates/tasks/${encodeURIComponent(task.id)}`)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View style={styles.head}>
                <TeammateAvatar teammate={teammate ?? { avatar: null }} size={32} />
                <Text style={styles.name} numberOfLines={1}>{teammate?.name ?? t('channels.unknownAgent')}</Text>
                <View style={styles.status}>
                    <StatusDot color={statusColor} />
                    <Text style={styles.muted}>{t(`teammates.taskStatus.${task.status}`)}</Text>
                </View>
            </View>
            {!!task.summary && <Text style={styles.summary} numberOfLines={2}>{task.summary}</Text>}
            <View style={styles.foot}>
                {liveRun ? (
                    <View style={styles.live}>
                        <Text style={styles.muted}>{t(`teammates.runStatus.${liveRun.status}`)}</Text>
                        <Text style={[styles.muted, styles.elapsed]}>{formatElapsed(now - (liveRun.startedAt ?? liveRun.queuedAt))}</Text>
                    </View>
                ) : (
                    <Text style={styles.muted}>{formatLastSeen(task.updatedAt)}</Text>
                )}
                <View style={styles.more}>
                    <Text style={styles.moreText}>{t('teammateTasks.view')}</Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.colors.text} />
                </View>
            </View>
        </Pressable>
    );
});

/** Issue page row for an issue no Agent is working on yet. */
export function TeammateDelegateRow({ onPress }: { onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, styles.delegate, pressed && styles.pressed]}>
            <View style={styles.delegateIcon}>
                <Ionicons name="add" size={20} color={theme.colors.textSecondary} />
            </View>
            <Text style={styles.delegateText} numberOfLines={1}>{t('teammateTasks.delegateIssue')}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

/** Kept in the route layout so the issue link never changes header configuration in the page. */
export function TeammateTaskIssueLink({ id }: { id: string }) {
    const task = storage(state => state.teammateTaskDetails[id]?.task);
    const router = useRouter();
    const { theme } = useUnistyles();
    const resource = task?.source === 'github-issue' ? task.resourceId?.match(/^([^/]+)\/([^#]+)#([1-9]\d*)$/) : null;
    if (!resource) return null;
    return (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('teammateTasks.issue')} style={{ padding: 8 }}
            onPress={() => router.push(`/repos/${encodeURIComponent(resource[1])}/${encodeURIComponent(resource[2])}/issue/${resource[3]}`)}>
            <Text style={{ color: theme.colors.header.tint }}>{t('teammateTasks.issue')}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface,
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    name: {
        ...Typography.default('semiBold'),
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    muted: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    summary: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        marginTop: 10,
    },
    foot: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    live: {
        flexDirection: 'row',
        gap: 8,
    },
    elapsed: {
        fontVariant: ['tabular-nums'],
    },
    more: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    moreText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    delegate: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    delegateIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    delegateText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.7,
    },
}));

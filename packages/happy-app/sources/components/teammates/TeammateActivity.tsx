import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TeammateTask } from 'happy-wire';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { startOfLocalDay, type TeammateTimelineDay, type TeammateTimelineItem } from '@/sync/teammateTimeline';
import { formatLastSeen } from '@/utils/sessionUtils';
import { Typography } from '@/constants/Typography';
import { getCurrentLanguage, t } from '@/text';
import { formatTeammateMoney, formatTeammateTokens, totalTeammateTokens } from '@/utils/teammateUsageFormat';
import { Card, SectionLabel, StatusDot } from './kit';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return t('time.durationSeconds', { count: seconds });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t('time.durationMinutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${t('time.durationHours', { count: hours })} ${t('time.durationMinutes', { count: rest })}` : t('time.durationHours', { count: hours });
}

function dayLabel(day: number): string {
    const today = startOfLocalDay(Date.now());
    if (day === today) return t('teammates.detail.today');
    if (day === startOfLocalDay(today - DAY_MS / 2)) return t('teammates.detail.yesterday');
    return new Date(day).toLocaleDateString(getCurrentLanguage(), { weekday: 'short', month: 'short', day: 'numeric' });
}

function TimelineRow({ item }: { item: TeammateTimelineItem }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const { run, task } = item;
    const color = item.tone === 'success' ? theme.colors.status.connected : item.tone === 'failure' ? theme.colors.textDestructive : theme.colors.textSecondary;
    const detail = [
        run.status === 'failed' ? t(`teammates.failure.${run.failureReason ?? 'unknown'}`) : run.status === 'cancelled' ? t('teammates.runStatus.cancelled') : item.durationMs !== null ? formatDuration(item.durationMs) : null,
        run.tokens !== null ? t('teammates.detail.tokenCount', { count: formatTeammateTokens(totalTeammateTokens(run.tokens)) }) : null,
        run.costUsd !== null ? formatTeammateMoney(run.costUsd) : null,
    ].filter(Boolean).join('  ');
    const open = run.sessionId ? () => navigateToSession(run.sessionId!)
        : task ? () => router.push(`/teammates/tasks/${encodeURIComponent(task.id)}`) : undefined;
    return (
        <Pressable accessibilityRole={open ? 'button' : undefined} disabled={!open} onPress={open} style={({ pressed }) => [styles.event, pressed && styles.pressed]}>
            <View style={styles.eventDot}><StatusDot color={color} /></View>
            <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={2}>{task?.title ?? t(`teammates.trigger.${run.trigger}`)}</Text>
                {!!detail && <Text style={[styles.eventDetail, run.status === 'failed' && { color: theme.colors.textDestructive }]} numberOfLines={2}>{detail}</Text>}
            </View>
            <Text style={styles.eventTime}>{new Date(item.at).toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' })}</Text>
        </Pressable>
    );
}

/** Finished runs grouped by day: a dot for the outcome, the task or trigger, then duration and cost or the failure. */
export function TeammateTimeline({ days }: { days: TeammateTimelineDay[] }) {
    return (
        <View>
            {days.map(day => (
                <View key={day.day}>
                    <Text style={styles.day}>{dayLabel(day.day)}</Text>
                    {day.items.map(item => <TimelineRow key={item.run.id} item={item} />)}
                </View>
            ))}
        </View>
    );
}

function TaskRow({ task }: { task: TeammateTask }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/teammates/tasks/${encodeURIComponent(task.id)}`)}
            style={({ pressed }) => [styles.task, pressed && styles.pressed]}>
            <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={2}>{task.title}</Text>
                <Text style={styles.eventDetail} numberOfLines={1}>{`${t(`teammates.taskStatus.${task.status}`)}  ${formatLastSeen(task.updatedAt)}`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

/** Active tasks first, then finished ones, each group in its own card. */
export function TeammateTaskList({ tasks }: { tasks: TeammateTask[] }) {
    const done = (task: TeammateTask) => task.status === 'done' || task.status === 'cancelled';
    const active = tasks.filter(task => !done(task));
    const past = tasks.filter(done);
    if (!tasks.length) return <Text style={styles.empty}>{t('teammates.noTasks')}</Text>;
    return (
        <View>
            {active.length > 0 && <>
                <SectionLabel title={t('teammates.activeTasks')} />
                <Card>{active.map(task => <TaskRow key={task.id} task={task} />)}</Card>
            </>}
            {past.length > 0 && <>
                <SectionLabel title={t('teammates.pastTasks')} />
                <Card>{past.map(task => <TaskRow key={task.id} task={task} />)}</Card>
            </>}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    day: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 28,
        marginBottom: 4,
    },
    event: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingVertical: 12,
    },
    eventDot: {
        height: 21,
        justifyContent: 'center',
    },
    eventBody: {
        flex: 1,
        gap: 4,
    },
    eventTitle: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.text,
    },
    eventDetail: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    eventTime: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 21,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    task: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
    },
    empty: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 40,
    },
    pressed: {
        opacity: 0.7,
    },
}));

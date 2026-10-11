import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { TeammateRun } from 'happy-wire';
import { formatLastSeen } from '@/utils/sessionUtils';
import { t } from '@/text';
import { Action, styles } from './ui';

export function isTeammateRunCancellable(run: TeammateRun): boolean {
    return run.status === 'queued' || run.status === 'dispatching' || run.status === 'running';
}

export function TeammateRunRow({ run, now, busy, onOpen, onCancel, openLabel = t('teammates.openSession'), showCancel = true, relativeTime = false }: {
    openLabel?: string;
    showCancel?: boolean;
    relativeTime?: boolean;
    run: TeammateRun;
    now: number;
    busy: boolean;
    onOpen: (sessionId: string) => void;
    onCancel: (run: TeammateRun) => void;
}) {
    const { theme } = useUnistyles();
    const statusColors: Record<TeammateRun['status'], string> = {
        queued: theme.colors.status.default,
        dispatching: theme.colors.status.connecting,
        running: theme.colors.status.connecting,
        completed: theme.colors.status.connected,
        failed: theme.colors.status.error,
        cancelled: theme.colors.textSecondary,
    };
    const seconds = Math.max(0, Math.floor(((run.finishedAt ?? now) - (run.startedAt ?? run.queuedAt)) / 1000));
    const duration = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return <View style={{ gap: 8, borderTopWidth: 1, borderColor: theme.colors.divider, paddingTop: 10 }}>
        <Pressable disabled={!run.sessionId} accessibilityRole={run.sessionId ? 'button' : undefined}
            accessibilityHint={run.sessionId ? openLabel : undefined}
            onPress={() => { if (run.sessionId) onOpen(run.sessionId); }} style={{ gap: 4, paddingVertical: 6 }}>
            <View style={styles.row}>
                <Text style={styles.text}>{t(`teammates.trigger.${run.trigger}`)}</Text>
                <Text style={[styles.text, { color: statusColors[run.status] }]}>{t(`teammates.runStatus.${run.status}`)}</Text>
            </View>
            <Text style={styles.muted}>{[relativeTime ? formatLastSeen(run.queuedAt) : new Date(run.queuedAt).toLocaleString(), duration, run.costUsd !== null ? `$${run.costUsd.toFixed(2)}` : null].filter(Boolean).join(' · ')}</Text>
            {run.failureReason && <Text style={styles.error}>{t(`teammates.failure.${run.failureReason}`)}</Text>}
        </Pressable>
        {showCancel && isTeammateRunCancellable(run) && <Action title={t('teammates.cancelRun')} disabled={busy} onPress={() => onCancel(run)} />}
    </View>;
}

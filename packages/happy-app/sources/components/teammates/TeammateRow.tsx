import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import type { Teammate } from 'happy-wire';
import { Item } from '@/components/Item';
import { storage, useMachine } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { getTeammateWorkload } from '@/sync/teammateWorkload';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { TeammateAvatar } from './ui';

/** One roster row: avatar with presence, name and role; a status label only when it is worth noticing. */
export const TeammateRow = React.memo(function TeammateRow({ teammate }: { teammate: Teammate }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const machine = useMachine(teammate.machineId);
    const runs = storage(state => state.teammateRuns[teammate.id]);
    const tasks = storage(state => state.teammateTasks[teammate.id]);
    const online = !!machine && isMachineOnline(machine);
    const workload = getTeammateWorkload(teammate, runs, tasks);
    const active = teammate.status === 'active';
    // Idle is the default state; labelling it on every row is noise.
    const status = !active ? { label: t(`teammates.status.${teammate.status}`), color: theme.colors.warning }
        : workload === 'working' ? { label: t('teammates.working'), color: theme.colors.status.connected }
        : workload === 'waiting' ? { label: t('teammates.waiting'), color: theme.colors.textLink }
        : null;

    return (
        <Item
            title={teammate.name || t('teammates.unnamed')}
            subtitle={teammate.role || undefined}
            subtitleLines={1}
            leftElement={(
                <View style={teammate.status === 'archived' && styles.archived}>
                    <TeammateAvatar teammate={teammate} size={40} />
                    <View style={[styles.presence, { backgroundColor: online ? theme.colors.status.connected : theme.colors.textSecondary }]} />
                </View>
            )}
            rightElement={status ? (
                <View style={styles.status}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={[styles.statusText, { color: status.color }]} numberOfLines={1}>{status.label}</Text>
                </View>
            ) : undefined}
            showChevron
            onPress={() => router.push(`/teammates/${teammate.id}`)}
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    archived: {
        opacity: 0.5,
    },
    presence: {
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: theme.colors.surface,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        maxWidth: 110,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        ...Typography.default(),
        fontSize: 13,
    },
}));

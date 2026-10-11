import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { CommandView } from '@/components/CommandView';
import { OrchestratorStatusBadge } from '@/components/orchestrator/OrchestratorStatusBadge';
import { resolveMachineName } from '@/components/orchestrator/display';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { t } from '@/text';
import type { MachineExecResult } from './machineExecResult';

const RUNNING_STATUSES = new Set(['queued', 'dispatching', 'running']);

/**
 * What a `machine_exec` call returned: the command's output on each machine, as far as it had got.
 * A machine still running has no output yet; the run page has it once the command ends.
 */
export function MachineExecOutput({ command, result }: { command: string; result: MachineExecResult; }) {
    const machineNameMap = useMachineNameMap();

    return (
        <View style={styles.container}>
            {result.tasks.map((task) => (
                <View key={task.taskId} style={styles.task}>
                    <View style={styles.header}>
                        <Text style={styles.machine} numberOfLines={1}>{resolveMachineName(task.machineId, machineNameMap)}</Text>
                        <OrchestratorStatusBadge status={task.status} />
                    </View>
                    <CommandView
                        command={command}
                        stdout={task.stdout}
                        stderr={task.stderr}
                        error={task.errorMessage}
                        hideEmptyOutput={RUNNING_STATUSES.has(task.status)}
                        fullWidth
                    />
                </View>
            ))}
            {!result.terminal && <Text style={styles.hint}>{t('settings.orchestratorExecStillRunning')}</Text>}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 12,
    },
    task: {
        gap: 6,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    machine: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
    },
    hint: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));

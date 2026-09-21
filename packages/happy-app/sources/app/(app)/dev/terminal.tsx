import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { TerminalInfo, TerminalSpawnRequest } from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { TerminalScreen } from '@/terminal/TerminalScreen';

/**
 * Opens a live terminal on a machine, to exercise the whole path by hand.
 *
 * Dev-only: no i18n, no error handling beyond showing what went wrong, and the
 * machine is picked for you.
 */
export default function TerminalDevScreen() {
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const [target, setTarget] = React.useState<{ machineId: string; terminalId: string } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isSpawning, setIsSpawning] = React.useState(false);

    const spawn = React.useCallback(async (machine: Machine) => {
        setError(null);
        setIsSpawning(true);
        try {
            const info = await apiSocket.machineRPC<TerminalInfo, TerminalSpawnRequest>(
                machine.id,
                'terminal-spawn',
                { cwd: machine.metadata?.homeDir ?? '/', rows: 24, cols: 80 },
            );
            setTarget({ machineId: machine.id, terminalId: info.id });
        } catch (spawnError) {
            setError(spawnError instanceof Error ? spawnError.message : 'Spawn failed');
        } finally {
            setIsSpawning(false);
        }
    }, []);

    if (target) {
        return (
            <View style={styles.root}>
                <TerminalScreen machineId={target.machineId} terminalId={target.terminalId} />
                <Pressable onPress={() => setTarget(null)} style={styles.close}>
                    <Text style={styles.closeText}>Close</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={[styles.root, styles.centered]}>
            {isSpawning ? <ActivityIndicator color={theme.colors.text} /> : null}
            {error ? <Text style={[styles.error, { color: theme.colors.textDestructive }]}>{error}</Text> : null}
            {machines.length === 0 ? (
                <Text style={{ color: theme.colors.text }}>No active machines</Text>
            ) : null}
            {machines.map((machine) => (
                <Pressable key={machine.id} onPress={() => void spawn(machine)} style={styles.machine}>
                    <Text style={{ color: theme.colors.text }}>
                        Open terminal on {machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    centered: {
        alignItems: 'center',
        gap: 12,
        justifyContent: 'center',
    },
    machine: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    close: {
        position: 'absolute',
        right: 12,
        top: 12,
    },
    closeText: {
        color: '#FFFFFF',
        fontSize: 12,
        opacity: 0.6,
    },
    error: {
        paddingHorizontal: 24,
        textAlign: 'center',
    },
});

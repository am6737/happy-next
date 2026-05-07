import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { RoundButton } from '@/components/RoundButton';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        paddingBottom: 40,
        gap: 16,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    cardTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 14,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 7,
    },
    infoLabel: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 13,
        fontWeight: '600',
    },
    typeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
    },
    typeText: {
        fontSize: 11,
        fontWeight: '600',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 4,
    },
    actionButton: {
        flex: 1,
    },
    progressContainer: {
        marginTop: 10,
        gap: 4,
    },
    progressBarBg: {
        height: 4,
        backgroundColor: theme.colors.divider,
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#007AFF',
    },
    progressText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginVertical: 12,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 80,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
        marginTop: 12,
    },
    emptySubtitle: {
        marginTop: 8,
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
}));

function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
}

function getCreatingStepLabel(progress: number): string {
    if (progress < 33) return 'Connecting to machine…';
    if (progress < 66) return 'Installing Happy Agent…';
    return 'Verifying connection…';
}

export default function MachineDetailScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();

    // Get machines from storage
    const allMachines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;
    const machine = id ? allMachines[id] : undefined;

    if (!machine) {
        return (
            <View style={[styles.container, styles.emptyContainer]}>
                <Stack.Screen options={{ title: 'Machine' }} />
                <Ionicons name="hardware-chip-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>Machine not found</Text>
                <Text style={styles.emptySubtitle}>This machine may have been removed</Text>
            </View>
        );
    }

    const isOnline = isMachineOnline(machine);
    const statusColor = isOnline ? '#34C759' : '#8E8E93';
    const statusLabel = isOnline ? 'Online' : 'Offline';
    const typeColor = machine.metadata?.platform === 'android' || machine.metadata?.platform === 'ios' ? '#AF52DE' : '#007AFF';
    const typeLabel = machine.metadata?.platform === 'android' || machine.metadata?.platform === 'ios' ? 'Local' : 'Cloud';
    const displayName = machine.metadata?.displayName || machine.metadata?.host || id?.slice(0, 8) || 'Unknown';
    const host = machine.metadata?.host || 'Unknown host';
    const lastSeen = formatTimeAgo(new Date(machine.activeAt).toISOString());
    const created = formatTimeAgo(new Date(machine.createdAt).toISOString());

    const handleStart = () => {
        // Machine start would require daemon restart - not implemented in this mock
        console.log('Start machine:', id);
    };

    const handleStop = () => {
        // Machine stop would require daemon stop - not implemented in this mock
        console.log('Stop machine:', id);
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ title: displayName }} />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}>
                {/* Status Card */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Status</Text>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Status</Text>
                        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
                            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                            <Text style={[styles.statusText, { color: statusColor }]}>
                                {statusLabel}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Type</Text>
                        <View style={[styles.typeBadge, { borderColor: `${typeColor}40` }]}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: typeColor }} />
                            <Text style={[styles.typeText, { color: typeColor }]}>{typeLabel}</Text>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Host</Text>
                        <Text style={styles.infoValue}>{host}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Last seen</Text>
                        <Text style={styles.infoValue}>{lastSeen}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Platform</Text>
                        <Text style={styles.infoValue}>{machine.metadata?.platform || 'Unknown'}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Created</Text>
                        <Text style={styles.infoValue}>{created}</Text>
                    </View>
                </View>

                {/* Actions Card */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Actions</Text>
                    <View style={styles.actionsRow}>
                        {isOnline && (
                            <RoundButton
                                size="normal"
                                title={t('lab.cloudStop')}
                                display="inverted"
                                onPress={handleStop}
                                style={styles.actionButton}
                            />
                        )}
                        {!isOnline && (
                            <RoundButton
                                size="normal"
                                title={t('lab.cloudStart')}
                                onPress={handleStart}
                                style={styles.actionButton}
                            />
                        )}
                    </View>
                </View>

                {/* Repositories Card */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Repositories</Text>
                    <Pressable
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
                        onPress={() => router.push('/repos')}
                    >
                        <Text style={{ fontSize: 14, color: '#007AFF' }}>View all repositories</Text>
                        <Ionicons name="chevron-forward" size={16} color="#007AFF" />
                    </Pressable>
                </View>
            </ScrollView>
        </View>
    );
}

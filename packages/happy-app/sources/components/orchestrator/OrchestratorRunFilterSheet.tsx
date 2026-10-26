import * as React from 'react';
import { View, Pressable, useWindowDimensions } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { sheetFill, sheetSafeAreaBottom } from '@/components/glassSheet';
import { liquidGlassAvailable } from '@/components/GlassSurface';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { storage, useSetting } from '@/sync/storage';
import { MACHINE_AVATAR_COLORS, MACHINE_AVATAR_ICONS, resolveMachineAvatar } from '@/components/MachineAvatar';
import { isMachineOnline } from '@/utils/machineUtils';
import type { OrchestratorRunCounts, OrchestratorRunFacets, OrchestratorRunKindFilter } from '@/sync/apiOrchestrator';
import { resolveMachineName } from '@/components/orchestrator/display';
import { sortMachines } from '@/utils/machineOrder';
import { t } from '@/text';

export const ORCHESTRATOR_RUN_KIND_ICONS: Record<OrchestratorRunKindFilter, React.ComponentProps<typeof Ionicons>['name']> = {
    agent: 'sparkles-outline',
    shell: 'terminal-outline',
    transfer: 'swap-horizontal-outline',
};

export function orchestratorRunKindLabel(kind: OrchestratorRunKindFilter): string {
    switch (kind) {
        case 'agent': return t('settings.orchestratorKindAgent');
        case 'shell': return t('settings.orchestratorKindShell');
        case 'transfer': return t('settings.orchestratorKindTransfer');
    }
}

// Each status is a disjoint slice of the runs, so together they add up to "all"; `active` covers queued, running and canceling.
export type OrchestratorRunStatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';

export const ORCHESTRATOR_RUN_STATUS_FILTERS: Array<{ key: OrchestratorRunStatusFilter; label: string; }> = [
    { key: 'all', label: t('settings.orchestratorFilterAll') },
    { key: 'active', label: t('settings.orchestratorFilterActive') },
    { key: 'completed', label: t('settings.orchestratorFilterCompleted') },
    { key: 'failed', label: t('settings.orchestratorFilterFailed') },
    { key: 'cancelled', label: t('settings.orchestratorFilterCancelled') },
];

function computeStatusCount(counts: OrchestratorRunCounts, filter: OrchestratorRunStatusFilter): number {
    if (filter === 'all') {
        return Object.values(counts).reduce((sum, n) => sum + n, 0);
    }
    if (filter === 'active') {
        return (counts['queued'] ?? 0) + (counts['running'] ?? 0) + (counts['canceling'] ?? 0);
    }
    return counts[filter] ?? 0;
}

const KIND_OPTIONS: Array<OrchestratorRunKindFilter | undefined> = [undefined, 'agent', 'shell', 'transfer'];

/** Every machine of the account, offline ones too: their past runs are still in the list. */
export function useOrchestratorFilterMachines() {
    return storage(useShallow((state) => sortMachines(Object.values(state.machines), state.settings.machineOrder)));
}

type OrchestratorRunFilterSheetProps = {
    status: OrchestratorRunStatusFilter;
    /** Runs per status under the kind and machine chosen */
    counts: OrchestratorRunCounts;
    onChangeStatus: (status: OrchestratorRunStatusFilter) => void;
    kind: OrchestratorRunKindFilter | undefined;
    machineId: string | undefined;
    onChangeKind: (kind: OrchestratorRunKindFilter | undefined) => void;
    onChangeMachine: (machineId: string | undefined) => void;
    /**
     * The machines and kinds the runs listed used, when the list is one conversation's: only those
     * are offered. The kinds show once there is one, saying what ran; the machines only with two
     * or more, as one would narrow nothing. Without it every machine of the account and every kind
     * is offered.
     */
    facets?: OrchestratorRunFacets;
};

/** The run list's filters: the run's status, which executor ran it, and on which machine. */
export const OrchestratorRunFilterSheet = React.memo(React.forwardRef<BottomSheetModal, OrchestratorRunFilterSheetProps>(({ status, counts, onChangeStatus, kind, machineId, onChangeKind, onChangeMachine, facets }, ref) => {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const accountMachines = useOrchestratorFilterMachines();
    const machineAvatars = useSetting('machineAvatars');
    const machines = facets ? accountMachines.filter((machine) => facets.machineIds.includes(machine.id)) : accountMachines;
    // A machine removed from the account since keeps its runs, so it stays to filter by, named by its id
    const removedMachineIds = facets ? facets.machineIds.filter((id) => !accountMachines.some((machine) => machine.id === id)) : [];
    const kindOptions = facets ? KIND_OPTIONS.filter((option) => option === undefined || facets.kinds.includes(option)) : KIND_OPTIONS;
    const showKinds = !facets || facets.kinds.length > 0;
    const showMachines = !facets || facets.machineIds.length > 1;
    const onlineCount = machines.filter(isMachineOnline).length;
    // Rows as the machine switcher draws them: the machine's avatar (or a desktop), a dot for online, and the state below the name
    const machineRows: Array<{ id: string | undefined; name: string; meta: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint?: string; online?: boolean; }> = [
        {
            id: undefined,
            name: t('settings.orchestratorFilterAllMachines'),
            meta: t('sessionScope.machineSummary', { total: machines.length + removedMachineIds.length, online: onlineCount }),
            icon: 'grid-outline',
        },
        ...machines.map((machine) => {
            const avatar = resolveMachineAvatar(machineAvatars, machine.id);
            const online = isMachineOnline(machine);
            return {
                id: machine.id,
                name: machine.metadata?.displayName || machine.metadata?.host || machine.id,
                meta: online ? t('status.online') : t('status.offline'),
                icon: avatar ? MACHINE_AVATAR_ICONS[avatar.icon] : 'desktop-outline' as const,
                tint: avatar ? MACHINE_AVATAR_COLORS[avatar.color] : undefined,
                online,
            };
        }),
        ...removedMachineIds.map((id) => ({
            id,
            name: resolveMachineName(id, new Map()),
            meta: t('status.offline'),
            icon: 'desktop-outline' as const,
            online: false,
        })),
    ];

    return (
        // As tall as what it holds, so one conversation's drawer with only the statuses stays short; a long machine list scrolls past 60% of the screen
        <AppBottomSheet ref={ref} enableDynamicSizing maxDynamicContentSize={windowHeight * 0.6}>
            {/* The last machine scrolls up clear of the home indicator. The title is in the scroll view, as the sheet's height is measured from what it holds. */}
            <BottomSheetScrollView contentContainerStyle={{ paddingBottom: sheetSafeAreaBottom(safeArea.bottom) + 24 }}>
                <View style={styles.title}>
                    <Text style={[styles.titleText, { color: theme.colors.textSecondary }]}>{t('settings.orchestratorFilter')}</Text>
                </View>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{t('settings.orchestratorFilterStatus')}</Text>
                <View style={styles.chipRow}>
                    {ORCHESTRATOR_RUN_STATUS_FILTERS.map((option) => {
                        const selected = option.key === status;
                        return (
                            <Pressable
                                key={option.key}
                                style={[styles.chip, { backgroundColor: selected ? theme.colors.button.primary.background : sheetFill(theme.colors.surface) }]}
                                onPress={() => onChangeStatus(option.key)}
                            >
                                <Text style={[styles.chipText, { color: selected ? theme.colors.button.primary.tint : theme.colors.text }]}>
                                    {option.label} ({computeStatusCount(counts, option.key)})
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                {showKinds ? <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{t('settings.orchestratorFilterKind')}</Text> : null}
                {showKinds ? <View style={styles.chipRow}>
                    {kindOptions.map((option) => {
                        const selected = option === kind;
                        const color = selected ? theme.colors.button.primary.tint : theme.colors.text;
                        return (
                            <Pressable
                                key={option ?? 'all'}
                                style={[styles.chip, { backgroundColor: selected ? theme.colors.button.primary.background : sheetFill(theme.colors.surface) }]}
                                onPress={() => onChangeKind(option)}
                            >
                                {option ? <Ionicons name={ORCHESTRATOR_RUN_KIND_ICONS[option]} size={14} color={color} /> : null}
                                <Text style={[styles.chipText, { color }]}>
                                    {option ? orchestratorRunKindLabel(option) : t('settings.orchestratorFilterAll')}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View> : null}
                {showMachines ? <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{t('settings.orchestratorFilterMachine')}</Text> : null}
                {showMachines && machineRows.map((row) => {
                    const selected = row.id === machineId;
                    return (
                        <Pressable
                            key={row.id ?? '__all__'}
                            style={({ pressed }) => [styles.row, pressed && !selected && { backgroundColor: sheetFill(theme.colors.surface) }]}
                            onPress={() => !selected && onChangeMachine(row.id)}
                        >
                            <View style={[styles.rowIcon, { backgroundColor: row.tint ?? sheetFill(theme.colors.surfaceHighest) }]}>
                                <Ionicons name={row.icon} size={18} color={row.tint !== undefined ? '#FFFFFF' : theme.colors.textSecondary} />
                                {row.online !== undefined ? (
                                    <View
                                        style={[styles.onlineDot, {
                                            backgroundColor: row.online ? theme.colors.status.connected : theme.colors.textSecondary,
                                            borderColor: theme.colors.groupped.background,
                                        }]}
                                    />
                                ) : null}
                            </View>
                            <View style={styles.rowCopy}>
                                <Text style={[styles.rowText, { color: theme.colors.text }]} numberOfLines={1}>{row.name}</Text>
                                <Text style={[styles.rowMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>{row.meta}</Text>
                            </View>
                            {selected ? <Ionicons name="checkmark" size={20} color={theme.colors.textLink} /> : null}
                        </Pressable>
                    );
                })}
            </BottomSheetScrollView>
        </AppBottomSheet>
    );
}));

const styles = StyleSheet.create(() => ({
    title: {
        paddingVertical: 8,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    titleText: { fontSize: 13, ...Typography.default('semiBold') },
    sectionTitle: {
        fontSize: 13,
        ...Typography.default('semiBold'),
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 4,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, gap: 4 },
    chipText: { ...Typography.default(), fontSize: 13 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 20,
        paddingVertical: 8,
    },
    rowIcon: {
        width: 32,
        height: 32,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    onlineDot: {
        position: 'absolute',
        right: -2,
        bottom: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        // The ring is the sheet's color, cut out of the tile; glass has no color to cut it in.
        borderWidth: liquidGlassAvailable ? 0 : 2,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    rowText: { fontSize: 15, ...Typography.default() },
    rowMeta: { marginTop: 2, fontSize: 12, ...Typography.default() },
}));

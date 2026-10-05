import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { shortenMachineId } from '@/components/orchestrator/display';
import { t } from '@/text';
import { formatLastSeen } from '@/utils/sessionUtils';
import { formatCompactDuration } from '@/utils/messageTime';
import {
    getContextDefaultEntries,
    groupModelModes,
    resolveContextMachineStatus,
    type ContextDefaultEntry,
    type ParsedOrchestratorContext,
} from './orchestratorContextDisplay';

/** A provider with more models than this starts collapsed, so a long catalog does not push the machines off screen. */
const MODEL_GROUPS_EXPANDED_LIMIT = 6;

const NOT_READY_COLOR = '#FF9500';

export function OrchestratorContextCard({ context }: { context: ParsedOrchestratorContext }) {
    const { theme } = useUnistyles();
    const defaults = getContextDefaultEntries(context.defaults);
    const modelProviders = Object.entries(context.modelModes).filter(([, modes]) => modes.length > 0);
    const currentMachineListed = context.machines.some((machine) => machine.machineId === context.machineId);

    return (
        <View style={styles.card}>
            <Text style={styles.title}>{t('settings.orchestratorContextTitle')}</Text>

            <View style={styles.infoList}>
                {context.controllerSessionId ? (
                    <InfoRow label={t('settings.orchestratorContextController')} value={context.controllerSessionId} mono />
                ) : null}
                {context.machineId && !currentMachineListed ? (
                    <InfoRow label={t('settings.orchestratorLabelMachine')} value={context.machineId} mono />
                ) : null}
                {context.workingDirectory ? (
                    <InfoRow label={t('settings.orchestratorLabelWorkingDir')} value={context.workingDirectory} mono />
                ) : null}
                {context.providers.length > 0 ? (
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>{t('settings.orchestratorContextProviders')}</Text>
                        <View style={[styles.chipRow, styles.infoChips]}>
                            {context.providers.map((provider) => (
                                <Chip key={provider} text={provider} />
                            ))}
                        </View>
                    </View>
                ) : null}
            </View>

            {defaults.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('settings.orchestratorContextDefaults')}</Text>
                    <View style={styles.chipRow}>
                        {defaults.map((entry) => (
                            <Chip key={entry.key} label={defaultLabel(entry)} text={defaultValue(entry)} />
                        ))}
                    </View>
                </View>
            ) : null}

            {modelProviders.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('settings.orchestratorContextModels')}</Text>
                    {modelProviders.map(([provider, modes]) => (
                        <ModelProviderSection key={provider} provider={provider} modes={modes} />
                    ))}
                </View>
            ) : null}

            {context.machines.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('settings.orchestratorRunMachines')}</Text>
                    {context.machines.map((machine, index) => (
                        <MachineRow
                            key={machine.machineId ?? `machine-${index}`}
                            machine={machine}
                            isCurrent={!!machine.machineId && machine.machineId === context.machineId}
                            separatorColor={theme.colors.modal.border}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={[styles.infoValue, mono && styles.mono]}>{value}</Text>
        </View>
    );
}

function Chip({ label, text }: { label?: string; text: string }) {
    return (
        <View style={styles.chip}>
            {label ? <Text style={styles.chipLabel}>{label}</Text> : null}
            <Text style={styles.chipText}>{text}</Text>
        </View>
    );
}

function defaultLabel(entry: ContextDefaultEntry): string {
    switch (entry.key) {
        case 'mode': return t('settings.orchestratorContextMode');
        case 'maxConcurrency': return t('settings.orchestratorContextMaxConcurrency');
        case 'waitTimeout': return t('settings.orchestratorContextWaitTimeout');
        case 'pollInterval': return t('settings.orchestratorContextPollInterval');
        case 'retryMaxAttempts': return t('settings.orchestratorContextRetryAttempts');
        case 'retryBackoff': return t('settings.orchestratorContextRetryBackoff');
    }
}

function defaultValue(entry: ContextDefaultEntry): string {
    return entry.kind === 'duration' ? formatCompactDuration(Number(entry.value)) : String(entry.value);
}

/** One provider's models, each with its efforts; a long list starts folded behind the provider's header. */
function ModelProviderSection({ provider, modes }: { provider: string; modes: string[] }) {
    const { theme } = useUnistyles();
    const groups = React.useMemo(() => groupModelModes(modes), [modes]);
    const [expanded, setExpanded] = React.useState(groups.length <= MODEL_GROUPS_EXPANDED_LIMIT);

    return (
        <View style={styles.providerSection}>
            <Pressable style={styles.providerHeader} onPress={() => setExpanded((value) => !value)} hitSlop={6}>
                <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={theme.colors.textSecondary} />
                <Text style={styles.providerName}>{provider}</Text>
                <Text style={styles.providerCount}>{groups.length}</Text>
            </Pressable>
            {expanded ? (
                <View style={styles.modelList}>
                    {groups.map((group) => (
                        <View key={group.model} style={styles.modelRow}>
                            <Text style={[styles.modelName, styles.mono]}>{group.model}</Text>
                            {group.efforts.map((effort) => (
                                <Text key={effort} style={styles.effortText}>{effort}</Text>
                            ))}
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function MachineRow({ machine, isCurrent, separatorColor }: {
    machine: ParsedOrchestratorContext['machines'][number];
    isCurrent: boolean;
    separatorColor: string;
}) {
    const { theme } = useUnistyles();
    const status = resolveContextMachineStatus(machine);
    const color = status === 'ready' ? theme.colors.success : status === 'notReady' ? NOT_READY_COLOR : theme.colors.textSecondary;
    const lastActiveAt = machine.lastActiveAt ? Date.parse(machine.lastActiveAt) : NaN;

    const statusText = status === 'ready'
        ? t('settings.orchestratorContextReady')
        : status === 'notReady'
            ? t('settings.orchestratorContextNotReady')
            : [t('status.offline'), Number.isNaN(lastActiveAt) ? null : t('status.lastSeen', { time: formatLastSeen(lastActiveAt, false) })]
                .filter(Boolean)
                .join(' · ');

    return (
        <View style={[styles.machineRow, { borderTopColor: separatorColor }, status !== 'ready' && styles.machineRowMuted]}>
            <View style={styles.machineHeader}>
                <View style={[styles.statusDot, { backgroundColor: color }]} />
                <Text style={styles.machineName} numberOfLines={1}>
                    {machine.name ?? (machine.machineId ? shortenMachineId(machine.machineId) : '-')}
                </Text>
                {isCurrent ? (
                    <View style={styles.currentBadge}>
                        <Text style={styles.currentBadgeText}>{t('settings.orchestratorContextThisMachine')}</Text>
                    </View>
                ) : null}
            </View>
            <Text style={[styles.machineStatus, { color }]}>{statusText}</Text>
            {machine.machineId ? <Text style={[styles.machineId, styles.mono]}>{machine.machineId}</Text> : null}
            {machine.providers && machine.providers.length > 0 ? (
                <View style={styles.chipRow}>
                    {machine.providers.map((provider) => (
                        <Chip key={provider} text={provider} />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 6,
        padding: 12,
        backgroundColor: theme.colors.surfaceHigh,
        overflow: 'hidden',
        gap: 12,
    },
    title: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text,
    },
    mono: {
        ...Typography.mono(),
    },
    infoList: {
        gap: 6,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    infoLabel: {
        width: 104,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    infoValue: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
    },
    section: {
        gap: 6,
    },
    sectionTitle: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    infoChips: {
        flex: 1,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: theme.colors.surfaceHighest,
    },
    chipLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    chipText: {
        fontSize: 11,
        color: theme.colors.text,
    },
    providerSection: {
        gap: 4,
    },
    providerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    providerName: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text,
    },
    providerCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    modelList: {
        gap: 4,
        paddingLeft: 18,
    },
    modelRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 6,
    },
    modelName: {
        fontSize: 12,
        color: theme.colors.text,
    },
    effortText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    machineRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
        paddingBottom: 2,
        gap: 3,
    },
    machineRowMuted: {
        opacity: 0.65,
    },
    machineHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    machineName: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
    },
    currentBadge: {
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 1,
        backgroundColor: theme.colors.surfaceHighest,
    },
    currentBadgeText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
    },
    machineStatus: {
        fontSize: 11,
        paddingLeft: 14,
    },
    machineId: {
        fontSize: 11,
        paddingLeft: 14,
        color: theme.colors.textSecondary,
    },
}));

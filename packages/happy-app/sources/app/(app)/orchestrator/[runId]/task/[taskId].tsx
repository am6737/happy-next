import * as React from 'react';
import { View, SectionList, ActivityIndicator, Pressable, RefreshControl, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { useAuth } from '@/auth/AuthContext';
import { getOrchestratorTask, type OrchestratorExecutionRecord, type OrchestratorProvider, type OrchestratorTaskDetail, type OrchestratorTaskRecord } from '@/sync/apiOrchestrator';
import { sync } from '@/sync/sync';
import { OrchestratorStatusBadge } from '@/components/orchestrator/OrchestratorStatusBadge';
import { OrchestratorDuration } from '@/components/orchestrator/OrchestratorDuration';
import {
    formatOrchestratorProviderLabel,
    parseOrchestratorTransferSpec,
    resolveTaskMachineId,
    resolveMachineName,
    resolveExecutionDurationMs,
    resolveOrchestratorExecutionPrompt,
    resolveOrchestratorTaskName,
    sanitizeOrchestratorOutputSummary,
    sortOrchestratorExecutionsByAttemptDesc,
} from '@/components/orchestrator/display';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { useOrchestratorLiveMessage } from '@/hooks/useOrchestratorLiveMessage';
import { formatDate } from '@/utils/formatDate';
import { t } from '@/text';

import { softHeaderOptions } from '@/components/navigation/softHeader';
import { hasWebTextSelection } from '@/components/webTextSelection';

// Mouse users copy what they select here (the desktop app is web too); a drag-select must not count as a tap on the card it is in
const IS_WEB = Platform.OS === 'web';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 24,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6,
    },
    title: {
        flex: 1,
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    row: {
        marginTop: 6,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    monoText: {
        fontSize: 12,
        color: theme.colors.text,
        lineHeight: 18,
        fontFamily: 'monospace',
    },
    sectionLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
        marginTop: 16,
        marginBottom: 12,
        paddingLeft: 4,
    },
    executionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    executionHeaderStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    executionStickyHeader: {
        backgroundColor: theme.colors.groupped.background,
        zIndex: 1,
    },
    executionSectionGap: {
        height: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    executionHeaderCardExpanded: {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderBottomWidth: 0,
    },
    executionDetailsCard: {
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
    },
    executionTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.text,
    },
    executionDetails: {
        paddingTop: 2,
    },
    executionDuration: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    detailLabel: {
        marginTop: 12,
        marginBottom: 6,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    summaryPreview: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    errorText: {
        marginTop: 12,
        color: theme.colors.textDestructive,
        textAlign: 'center',
    },
    hint: {
        marginTop: 8,
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
}));

function buildTaskTitle(task: OrchestratorTaskRecord): string {
    return resolveOrchestratorTaskName(task) ?? t('settings.orchestratorProviderTask', { provider: task.provider });
}

function ExecutionResult({ execution }: { execution: OrchestratorExecutionRecord; }) {
    if (execution.provider === 'transfer') {
        return <TransferExecutionResult execution={execution} />;
    }
    return execution.provider === 'shell'
        ? <ShellExecutionResult execution={execution} />
        : <AgentExecutionResult execution={execution} provider={execution.provider} />;
}

/** The result of one transfer: what arrived where, which the daemon reports once it ends. */
function TransferExecutionResult({ execution }: { execution: OrchestratorExecutionRecord; }) {
    const styles = stylesheet;
    return (
        <>
            <Text selectable={IS_WEB} style={styles.detailLabel}>{t('settings.orchestratorResultTitle')}</Text>
            {execution.status === 'running'
                ? <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorTransferRunningHint')}</Text>
                : (
                    <>
                        {!!execution.errorCode && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorCode')}: {execution.errorCode}</Text>}
                        {execution.errorMessage
                            ? <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorMessage')}: {execution.errorMessage}</Text>
                            : <Text style={styles.monoText} selectable>{execution.outputSummary || '-'}</Text>}
                    </>
                )}
        </>
    );
}

/**
 * The result of one shell command: its stdout and stderr apart. The daemon reports both once the
 * command ends, so a running one has nothing to show yet.
 */
function ShellExecutionResult({ execution }: { execution: OrchestratorExecutionRecord; }) {
    const styles = stylesheet;
    if (execution.status === 'running') {
        return (
            <>
                <Text selectable={IS_WEB} style={styles.detailLabel}>{t('settings.orchestratorResultTitle')}</Text>
                <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorShellRunningHint')}</Text>
            </>
        );
    }
    return (
        <>
            {!!execution.errorCode && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorCode')}: {execution.errorCode}</Text>}
            {!!execution.errorMessage && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorMessage')}: {execution.errorMessage}</Text>}
            <Text selectable={IS_WEB} style={styles.detailLabel}>{t('settings.orchestratorStdoutTitle')}</Text>
            <Text style={styles.monoText} selectable>{execution.outputText || '-'}</Text>
            <Text selectable={IS_WEB} style={styles.detailLabel}>{t('settings.orchestratorStderrTitle')}</Text>
            <Text style={styles.monoText} selectable>{execution.stderrText || '-'}</Text>
        </>
    );
}

/**
 * The result of one AI execution. A finished one shows the output the daemon stored (the provider's
 * final message). A running one is only mounted while its card is expanded, so following its
 * conversation starts on expand and stops on collapse.
 */
function AgentExecutionResult({ execution, provider }: { execution: OrchestratorExecutionRecord; provider: Exclude<OrchestratorProvider, 'shell' | 'transfer'>; }) {
    const styles = stylesheet;
    const isRunning = execution.status === 'running';
    const liveMessage = useOrchestratorLiveMessage({
        machineId: execution.machineId,
        provider,
        childSessionId: execution.childSessionId,
        enabled: isRunning,
    });

    const title = isRunning
        ? t('settings.orchestratorLatestMessageTitle')
        : execution.status === 'completed'
            ? t('settings.orchestratorLastMessageTitle')
            : t('settings.orchestratorResultTitle');
    const text = isRunning
        ? liveMessage
        : execution.outputText || sanitizeOrchestratorOutputSummary(execution.outputSummary);

    return (
        <>
            <Text selectable={IS_WEB} style={styles.detailLabel}>{title}</Text>
            {!!execution.errorCode && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorCode')}: {execution.errorCode}</Text>}
            {!!execution.errorMessage && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelErrorMessage')}: {execution.errorMessage}</Text>}
            <Text style={styles.monoText} selectable>{text || '-'}</Text>
        </>
    );
}

export default function OrchestratorTaskDetailScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { runId, taskId } = useLocalSearchParams<{ runId: string; taskId: string; }>();
    const auth = useAuth();
    const credentials = auth.credentials;
    const machineNameMap = useMachineNameMap();

    const [run, setRun] = React.useState<OrchestratorTaskDetail['run'] | null>(null);
    const [task, setTask] = React.useState<OrchestratorTaskRecord | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [expandedExecutionIds, setExpandedExecutionIds] = React.useState<Set<string>>(() => new Set());

    const loadTask = React.useCallback(async (opts?: { silent?: boolean; }) => {
        if (!credentials || !runId || !taskId) {
            return;
        }
        if (!opts?.silent) {
            setLoading(true);
        }
        try {
            setError(null);
            const taskData = await getOrchestratorTask(credentials, sync.encryption, runId, taskId, {
                includeExecutions: true,
            });
            setRun(taskData.run);
            setTask(taskData.task);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('settings.orchestratorTaskLoadError'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [credentials, runId, taskId]);

    useFocusEffect(React.useCallback(() => {
        if (!credentials || !runId || !taskId) {
            return () => undefined;
        }
        let active = true;
        void loadTask();
        const interval = setInterval(() => {
            if (!active) {
                return;
            }
            void loadTask({ silent: true });
        }, 5000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [credentials, runId, taskId, loadTask]));

    const sortedExecutions = React.useMemo(
        () => sortOrchestratorExecutionsByAttemptDesc(task?.executions ?? []),
        [task?.executions],
    );

    if (loading && !task) {
        return (
            <View style={styles.center}>
                <Stack.Screen options={{ ...softHeaderOptions, headerTitle: t('settings.orchestratorTaskDetails') }} />
                <ActivityIndicator size="large" />
                <Text selectable={IS_WEB} style={styles.hint}>{t('settings.orchestratorLoadingTask')}</Text>
            </View>
        );
    }

    if (!task) {
        return (
            <View style={styles.center}>
                <Stack.Screen options={{ ...softHeaderOptions, headerTitle: t('settings.orchestratorTaskDetails') }} />
                <Text selectable={IS_WEB} style={styles.sectionTitle}>{t('settings.orchestratorTaskNotFound')}</Text>
                {!!error && <Text selectable={IS_WEB} style={styles.errorText}>{error}</Text>}
            </View>
        );
    }

    const providerLabel = formatOrchestratorProviderLabel(task);
    const promptLabel = task.provider === 'shell'
        ? t('settings.orchestratorLabelCommand')
        : task.provider === 'transfer'
            ? t('settings.orchestratorLabelTransfer')
            : t('settings.orchestratorLabelPrompt');
    // A transfer's prompt is its spec, shown as where it copies from and to
    const transferSpec = task.provider === 'transfer' ? parseOrchestratorTransferSpec(task.prompt) : null;
    const taskPrompt = transferSpec
        ? `${resolveMachineName(transferSpec.sourceMachineId, machineNameMap)}:${transferSpec.sourcePath} → ${transferSpec.targetPath}${transferSpec.overwrite ? ' (overwrite)' : ''}`
        : task.prompt;
    const executionSections: Array<{
        key: string;
        execution: OrchestratorExecutionRecord | null;
        data: string[];
    }> = sortedExecutions.length > 0
        ? sortedExecutions.map((execution) => ({
            key: execution.executionId,
            execution,
            data: [execution.executionId],
        }))
        : [{ key: 'pending', execution: null, data: ['pending'] }];

    const toggleExecution = (executionId: string) => {
        setExpandedExecutionIds((current) => {
            const next = new Set(current);
            if (next.has(executionId)) {
                next.delete(executionId);
            } else {
                next.add(executionId);
            }
            return next;
        });
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ ...softHeaderOptions, headerTitle: t('settings.orchestratorTaskSeq', { seq: task.seq }) }} />
            <SectionList
                sections={executionSections}
                contentInsetAdjustmentBehavior="automatic"
                keyExtractor={(item) => item}
                stickySectionHeadersEnabled={Platform.OS !== 'ios'}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
                    setRefreshing(true);
                    void loadTask({ silent: true });
                }} tintColor={theme.colors.textSecondary} />}
                contentContainerStyle={[
                    styles.contentContainer,
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
                ListHeaderComponent={(
                    <>
                        <View style={styles.card}>
                            <View style={styles.header}>
                                <Text selectable={IS_WEB} style={styles.title} numberOfLines={1}>{buildTaskTitle(task)}</Text>
                                <OrchestratorStatusBadge status={task.status} />
                            </View>
                            <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelRun')}: {run?.title || run?.runId || runId}</Text>
                            <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelProvider')}: {providerLabel}</Text>
                            <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelMachine')}: {(() => {
                                const machineId = resolveTaskMachineId(task);
                                return machineId ? resolveMachineName(machineId, machineNameMap) : '-';
                            })()}</Text>
                            {!!task.taskKey && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelTaskKey')}: {task.taskKey}</Text>}
                            <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelWorkingDir')}: {task.workingDirectory || '-'}</Text>
                            {task.dependsOn.length > 0 && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelDependsOn')}: {task.dependsOn.join(', ')}</Text>}
                            {(task.retry.maxAttempts > 1 || task.retry.backoffMs > 0) && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelRetryPolicy')}: {t('settings.orchestratorRetryPolicyValue', { maxAttempts: task.retry.maxAttempts, backoffMs: task.retry.backoffMs })}</Text>}
                            {!!task.nextAttemptAt && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelNextAttempt')}: {formatDate(task.nextAttemptAt)}</Text>}
                        </View>
                        <Text selectable={IS_WEB} style={styles.sectionLabel}>{t('settings.orchestratorExecutionHistoryTitle')}</Text>
                    </>
                )}
                renderSectionHeader={({ section }) => {
                    const execution = section.execution;
                    const executionId = section.key;
                    const isExpanded = expandedExecutionIds.has(executionId);
                    if (!isExpanded) {
                        return null;
                    }
                    const attempt = execution?.attempt ?? 1;
                    const machineId = execution ? resolveMachineName(execution.machineId, machineNameMap) : '-';
                    const status = execution?.status ?? task.status;

                    return (
                        <View style={styles.executionStickyHeader}>
                            <Pressable
                                style={[styles.card, styles.executionHeaderCardExpanded]}
                                onPress={() => !hasWebTextSelection() && toggleExecution(executionId)}
                            >
                                <View style={styles.executionHeader}>
                                    <Text selectable={IS_WEB} style={styles.executionTitle}>
                                        {t('settings.orchestratorAttemptTitle', { attempt, machineId })}
                                    </Text>
                                    <View style={styles.executionHeaderStatus}>
                                        <OrchestratorStatusBadge status={status} />
                                        <Ionicons
                                            name="chevron-up"
                                            size={18}
                                            color={theme.colors.textSecondary}
                                        />
                                    </View>
                                </View>
                            </Pressable>
                        </View>
                    );
                }}
                renderItem={({ section }) => {
                    const execution = section.execution;
                    if (!expandedExecutionIds.has(section.key)) {
                        const attempt = execution?.attempt ?? 1;
                        const machineId = execution ? resolveMachineName(execution.machineId, machineNameMap) : '-';
                        const status = execution?.status ?? task.status;
                        const summary = execution ? sanitizeOrchestratorOutputSummary(execution.outputSummary) : null;
                        return (
                            <Pressable style={styles.card} onPress={() => !hasWebTextSelection() && toggleExecution(section.key)}>
                                <View style={styles.executionHeader}>
                                    <Text selectable={IS_WEB} style={styles.executionTitle}>
                                        {t('settings.orchestratorAttemptTitle', { attempt, machineId })}
                                    </Text>
                                    <View style={styles.executionHeaderStatus}>
                                        {execution ? (
                                            <OrchestratorDuration
                                                style={styles.executionDuration}
                                                live={execution.status === 'running'}
                                                resolve={(now) => resolveExecutionDurationMs(execution, now)}
                                            />
                                        ) : null}
                                        <OrchestratorStatusBadge status={status} />
                                        <Ionicons
                                            name="chevron-down"
                                            size={18}
                                            color={theme.colors.textSecondary}
                                        />
                                    </View>
                                </View>
                                {summary ? <Text selectable={IS_WEB} style={styles.summaryPreview} numberOfLines={2}>{summary}</Text> : null}
                            </Pressable>
                        );
                    }

                    if (!execution) {
                        return (
                            <View style={[styles.card, styles.executionDetailsCard]}>
                                <View style={styles.executionDetails}>
                                    <Text selectable={IS_WEB} style={[styles.detailLabel, { marginTop: 0 }]}>{promptLabel}</Text>
                                    <Text style={styles.monoText} selectable>{taskPrompt || '-'}</Text>
                                </View>
                            </View>
                        );
                    }

                    const executionPrompt = resolveOrchestratorExecutionPrompt(taskPrompt, execution);
                    return (
                        <View style={[styles.card, styles.executionDetailsCard]}>
                            <View style={styles.executionDetails}>
                                <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelStarted')}: {formatDate(execution.startedAt)}</Text>
                                <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelFinished')}: {formatDate(execution.finishedAt)}</Text>
                                <OrchestratorDuration
                                    style={styles.row}
                                    label={t('settings.orchestratorLabelDuration')}
                                    live={execution.status === 'running'}
                                    resolve={(now) => resolveExecutionDurationMs(execution, now)}
                                />
                                <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelExitCode')}: {execution.exitCode ?? '-'}</Text>
                                {!!execution.signal && <Text selectable={IS_WEB} style={styles.row}>{t('settings.orchestratorLabelSignal')}: {execution.signal}</Text>}

                                <Text selectable={IS_WEB} style={styles.detailLabel}>{promptLabel}</Text>
                                <Text style={styles.monoText} selectable>{executionPrompt || '-'}</Text>

                                <ExecutionResult execution={execution} />
                            </View>
                        </View>
                    );
                }}
                renderSectionFooter={() => <View style={styles.executionSectionGap} />}
                ListFooterComponent={error ? <Text selectable={IS_WEB} style={styles.errorText}>{error}</Text> : null}
            />
        </View>
    );
}

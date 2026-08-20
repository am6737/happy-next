import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { AiIdentityAvatar } from './components';
import { findAiAgent, getAiTeamMockData, type AiExecution, type AiExecutionStatus } from './mockData';
import { getCurrentLanguage } from '@/text';

type Props = {
    executions: AiExecution[];
    onOpenExecution: (executionId: string) => void;
};

function statusIcon(status: AiExecutionStatus): React.ComponentProps<typeof Ionicons>['name'] {
    if (status === 'completed') return 'checkmark-circle-outline';
    if (status === 'failed') return 'close-circle-outline';
    if (status === 'waiting_human') return 'pause-circle-outline';
    if (status === 'running' || status === 'reviewing') return 'play-circle-outline';
    return 'ellipse-outline';
}

function statusColor(status: AiExecutionStatus, theme: ReturnType<typeof useUnistyles>['theme']): string {
    if (status === 'completed') return theme.colors.success;
    if (status === 'failed') return theme.colors.textDestructive;
    if (status === 'waiting_human') return theme.colors.warning;
    return theme.colors.textSecondary;
}

export function MockIssueExecutionLog({ executions, onOpenExecution }: Props) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const isChinese = getCurrentLanguage().startsWith('zh');
    const data = getAiTeamMockData();
    const [showPastRuns, setShowPastRuns] = React.useState(true);

    if (executions.length === 0) return null;

    const [latestRun, ...pastRuns] = executions;
    const visibleRuns = showPastRuns ? executions : [latestRun];

    return (
        <View style={styles.container}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>{isChinese ? '执行记录' : 'Execution log'}</Text>
                <Text style={styles.runCount}>{isChinese ? `${executions.length} 次执行` : `${executions.length} runs`}</Text>
            </View>

            {pastRuns.length > 0 && (
                <Pressable style={styles.toggle} onPress={() => setShowPastRuns((value) => !value)}>
                    <Ionicons name={showPastRuns ? 'chevron-down' : 'chevron-forward'} size={13} color={theme.colors.textSecondary} />
                    <Text style={styles.toggleText}>
                        {showPastRuns
                            ? (isChinese ? `隐藏历史执行（${pastRuns.length}）` : `Hide past runs (${pastRuns.length})`)
                            : (isChinese ? `显示历史执行（${pastRuns.length}）` : `Show past runs (${pastRuns.length})`)}
                    </Text>
                </Pressable>
            )}

            <View style={styles.list}>
                {visibleRuns.map((execution) => {
                    const agent = findAiAgent(data, execution.agentId);
                    return (
                        <Pressable
                            key={execution.id}
                            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                            onPress={() => onOpenExecution(execution.id)}
                        >
                            {agent ? <AiIdentityAvatar id={agent.id} name={agent.name} size={22} /> : null}
                            <Text style={styles.agentName} numberOfLines={1}>{agent?.name ?? '-'}</Text>
                            <Text style={styles.runLabel} numberOfLines={1}>
                                {isChinese ? `第${execution.attempt}次执行` : `Run ${execution.attempt}`}
                            </Text>
                            <Text style={styles.startedAt} numberOfLines={1}>{execution.startedAt}</Text>
                            <Ionicons
                                name={statusIcon(execution.status)}
                                size={16}
                                color={statusColor(execution.status, theme)}
                            />
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: { gap: 8 },
    titleRow: { flexDirection: 'row', alignItems: 'center' },
    title: { ...Typography.default('semiBold'), color: theme.colors.textSecondary, fontSize: 14 },
    runCount: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, marginLeft: 'auto' },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
    toggleText: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12 },
    list: { gap: 2 },
    row: {
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingLeft: 18,
        paddingRight: 2,
    },
    agentName: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 13, flexShrink: 0 },
    runLabel: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 13, flex: 1, minWidth: 0 },
    startedAt: { ...Typography.default(), color: theme.colors.textSecondary, fontSize: 12, flexShrink: 0 },
    pressed: { opacity: 0.55 },
}));

import * as React from 'react';
import { View, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { getIssuesForRepo, type RepoIssue } from '@/data/mockRepos';
import { Modal } from '@/modal';
import { t } from '@/text';

const AI_STATUS_COLORS: Record<string, string> = {
    idle: '#8E8E93',
    running: '#007AFF',
    completed: '#34C759',
    failed: '#FF3B30',
};

const AI_STATUS_LABELS: Record<string, string> = {
    idle: 'Not started',
    running: 'Auto Pilot is active',
    completed: 'Resolved by Auto Pilot',
    failed: 'Auto Pilot failed',
};

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

const AI_STEPS = [
    { id: 'analyze', label: 'Analyzing repository context', description: 'Searching for relevant code patterns...', weight: 20 },
    { id: 'plan', label: 'Creating implementation plan', description: 'Creating a detailed implementation plan...', weight: 40 },
    { id: 'apply', label: 'Applying code changes', description: 'Modifying files in the codebase...', weight: 65 },
    { id: 'verify', label: 'Running test suite', description: 'Running automated tests...', weight: 85 },
    { id: 'deliver', label: 'Creating Pull Request', description: 'Submitting changes for review...', weight: 100 },
];

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
    titleCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    issueNumber: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: '500',
        marginBottom: 6,
    },
    issueTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: theme.colors.text,
        lineHeight: 28,
        letterSpacing: -0.5,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 12,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    metaText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    stateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    stateBadgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    labelsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    labelPill: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    labelText: {
        fontSize: 12,
        fontWeight: '600',
    },
    aiCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    aiCardTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 16,
    },
    aiStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 20,
    },
    aiStatusText: {
        fontSize: 17,
        fontWeight: '600',
    },
    stepItem: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    stepIconContainer: {
        width: 24,
        alignItems: 'center',
    },
    stepLine: {
        position: 'absolute',
        top: 24,
        bottom: -20,
        width: 1,
        backgroundColor: theme.colors.divider,
    },
    stepContent: {
        flex: 1,
    },
    stepLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 2,
    },
    stepDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    progressContainer: {
        marginTop: 4,
        marginBottom: 20,
    },
    progressBar: {
        height: 3,
        backgroundColor: theme.colors.divider,
        borderRadius: 1.5,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#007AFF',
    },
    resultCard: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 12,
        padding: 16,
        marginTop: 8,
    },
    resultTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 4,
    },
    resultDescription: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        lineHeight: 20,
        marginBottom: 12,
    },
    prLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    prLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#007AFF',
    },
    bodyCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    bodyTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    bodyText: {
        fontSize: 15,
        color: theme.colors.text,
        lineHeight: 22,
        ...Typography.default('regular'),
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Fix Menu
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
    },
    menuIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    menuSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));

export default function IssueDetailScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo, number: numberStr } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();

    const fullName = `${owner}/${repo}`;
    const issueNumber = parseInt(numberStr, 10);
    const issues = getIssuesForRepo(fullName);
    const originalIssue = issues.find((i) => i.number === issueNumber);

    const [progress, setProgress] = React.useState(originalIssue?.progress || 0);
    const [currentPhase, setCurrentPhase] = React.useState<'analyze' | 'modify' | 'pr' | undefined>(originalIssue?.currentPhase);
    const [aiStatus, setAiStatus] = React.useState<'idle' | 'running' | 'completed' | 'failed'>(originalIssue?.aiStatus || 'idle');

    // Mock progress simulation: 0-30 analyze, 30-70 modify, 70-100 pr
    React.useEffect(() => {
        if (aiStatus === 'running') {
            const interval = setInterval(() => {
                setProgress((p) => {
                    const next = p + 1;
                    if (next >= 100) {
                        setAiStatus('completed');
                        clearInterval(interval);
                        return 100;
                    }
                    // Update phase based on progress
                    if (next >= 70 && p < 70) {
                        setCurrentPhase('pr');
                    } else if (next >= 30 && p < 30) {
                        setCurrentPhase('modify');
                    }
                    return next;
                });
            }, 100); // 100 steps × 100ms = 10s total
            return () => clearInterval(interval);
        }
    }, [aiStatus]);

    const handleStartFix = React.useCallback(async () => {
        setAiStatus('running');
        setProgress(0);
        setCurrentPhase('analyze');
    }, []);

    const handleStopFix = React.useCallback(() => {
        setAiStatus('failed');
    }, []);

    if (!originalIssue) {
        return (
            <View style={[styles.container, styles.center]}>
                <Stack.Screen options={{ headerTitle: `Issue #${numberStr}` }} />
                <Text style={{ fontSize: 16, color: theme.colors.textSecondary }}>{t('lab.issueNotFound')}</Text>
            </View>
        );
    }

    const issue = { ...originalIssue, aiStatus, currentPhase, progress };
    const statusColor = AI_STATUS_COLORS[issue.aiStatus];
    const isOpen = issue.state === 'open';

    const renderStep = (step: typeof AI_STEPS[0], index: number) => {
        // Map step.id to currentPhase
        const stepPhaseMap: Record<string, 'analyze' | 'modify' | 'pr'> = {
            'analyze': 'analyze',
            'plan': 'analyze',
            'apply': 'modify',
            'verify': 'modify',
            'deliver': 'pr',
        };
        const stepPhase = stepPhaseMap[step.id];
        const isDone = progress >= step.weight;
        const isCurrent = currentPhase === stepPhase && !isDone;
        const isLast = index === AI_STEPS.length - 1;

        return (
            <View key={step.id} style={styles.stepItem}>
                <View style={styles.stepIconContainer}>
                    {!isLast && <View style={styles.stepLine} />}
                    {isDone ? (
                        <Ionicons name="checkmark-circle" size={22} color="#34C759" />
                    ) : isCurrent ? (
                        <ActivityIndicator size="small" color="#007AFF" />
                    ) : (
                        <Ionicons name="ellipse-outline" size={22} color={theme.colors.divider} />
                    )}
                </View>
                <View style={styles.stepContent}>
                    <Text style={[
                        styles.stepLabel,
                        { color: isDone || isCurrent ? theme.colors.text : theme.colors.textSecondary }
                    ]}>
                        {step.label}
                    </Text>
                    {(isCurrent || isDone) && (
                        <Text style={styles.stepDescription}>{step.description}</Text>
                    )}
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: `#${issue.number}` }} />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}>
                {/* Title Card */}
                <View style={styles.titleCard}>
                    <Text style={styles.issueNumber}>#{issue.number}</Text>
                    <Text style={styles.issueTitle}>{issue.title}</Text>
                    <View style={styles.metaRow}>
                        <View style={[styles.stateBadge, { backgroundColor: isOpen ? '#34C75915' : '#AF52DE15' }]}>
                            <Ionicons name={isOpen ? 'alert-circle' : 'checkmark-circle'} size={14} color={isOpen ? '#34C759' : '#AF52DE'} />
                            <Text style={[styles.stateBadgeText, { color: isOpen ? '#34C759' : '#AF52DE' }]}>{isOpen ? 'Open' : 'Closed'}</Text>
                        </View>
                        <View style={styles.metaItem}><Ionicons name="person-outline" size={14} color={theme.colors.textSecondary} /><Text style={styles.metaText}>@{issue.author}</Text></View>
                    </View>
                    {issue.labels.length > 0 && (
                        <View style={styles.labelsRow}>
                            {issue.labels.map((label) => (
                                <View key={label.name} style={[styles.labelPill, { backgroundColor: `#${label.color}15` }]}><Text style={[styles.labelText, { color: `#${label.color}` }]}>{label.name}</Text></View>
                            ))}
                        </View>
                    )}
                </View>

                {/* AI Console Card */}
                <View style={styles.aiCard}>
                    <Text style={styles.aiCardTitle}>Working on it</Text>
                    <View style={styles.aiStatusRow}>
                        {aiStatus === 'running' ? <ActivityIndicator size="small" color="#007AFF" /> : <View style={{ backgroundColor: statusColor, width: 10, height: 10, borderRadius: 5 }} />}
                        <Text style={[styles.aiStatusText, { color: statusColor }]}>{AI_STATUS_LABELS[issue.aiStatus]}</Text>
                        {aiStatus === 'running' && (
                            <>
                                <Pressable
                                    style={{ marginLeft: 'auto', marginRight: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#FF3B30' }}
                                    onPress={handleStopFix}
                                >
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#FF3B30' }}>Stop</Text>
                                </Pressable>
                                <Pressable onPress={() => router.push(`/session/sess-ai-${issue.number}`)}>
                                    <Text style={{ color: '#007AFF', fontWeight: '600' }}>Observe</Text>
                                </Pressable>
                            </>
                        )}
                    </View>

                    {aiStatus === 'running' && (
                        <View style={styles.progressContainer}>
                            <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                        </View>
                    )}

                    {(aiStatus === 'running' || aiStatus === 'completed') && (
                        <View style={{ marginTop: 10 }}>{AI_STEPS.map((step, idx) => renderStep(step, idx))}</View>
                    )}

                    {aiStatus === 'completed' && (
                        <View style={styles.resultCard}>
                            <Text style={styles.resultTitle}>Delivered</Text>
                            <Text style={styles.resultDescription}>AI has successfully created a Pull Request with the changes.</Text>
                            {issue.linkedPR ? (
                                <Pressable
                                    style={styles.prLink}
                                    onPress={() => router.push(`/repos/${owner}/${repo}/pulls/${issue.linkedPR}`)}
                                >
                                    <Ionicons name="git-pull-request" size={18} color="#007AFF" />
                                    <Text style={styles.prLinkText}>View Pull Request #{issue.linkedPR}</Text>
                                </Pressable>
                            ) : (
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>PR link will appear once created.</Text>
                            )}
                        </View>
                    )}

                    {aiStatus === 'idle' && isOpen && (
                        <RoundButton title="Start Working" onPress={handleStartFix} />
                    )}

                    {aiStatus === 'failed' && <RoundButton title="Retry" onPress={handleStartFix} />}
                </View>

                {/* Issue body */}
                <View style={styles.bodyCard}>
                    <Text style={styles.bodyTitle}>Description</Text>
                    <Text style={styles.bodyText}>{issue.body}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

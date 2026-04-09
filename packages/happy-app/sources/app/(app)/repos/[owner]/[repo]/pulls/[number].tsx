import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { getPRsForRepo, getIssuesForRepo, type RepoPR } from '@/data/mockRepos';
import { t } from '@/text';

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

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

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
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statusBadgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    prNumber: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    prTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: theme.colors.text,
        lineHeight: 28,
        letterSpacing: -0.5,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
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
    metaTextBold: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.text,
    },
    branchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    bodyCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    sectionTitle: {
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
    linkedIssueCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    filesCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
    },
    fileIcon: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileName: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
    fileStats: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    insertions: {
        fontSize: 12,
        color: '#34C759',
        fontWeight: '600',
    },
    deletions: {
        fontSize: 12,
        color: '#FF3B30',
        fontWeight: '600',
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    commitsCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    commitItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    commitSha: {
        fontSize: 12,
        color: '#007AFF',
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        fontWeight: '600',
    },
    commitMessage: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
    },
    commitAuthor: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));

// Mock files changed data
const MOCK_PR_FILES: Record<number, Array<{ name: string; insertions: number; deletions: number }>> = {
    46: [
        { name: 'src/components/SearchBar.tsx', insertions: 45, deletions: 12 },
        { name: 'src/hooks/useSearch.ts', insertions: 23, deletions: 0 },
        { name: 'package.json', insertions: 2, deletions: 1 },
    ],
    45: [
        { name: 'src/session/share.ts', insertions: 120, deletions: 0 },
        { name: 'src/session/types.ts', insertions: 30, deletions: 0 },
    ],
    44: [
        { name: 'src/sync/socket.ts', insertions: 18, deletions: 5 },
    ],
};

// Mock commits data per PR
const MOCK_PR_COMMITS: Record<number, Array<{ sha: string; message: string; author: string; createdAt: string }>> = {
    46: [
        { sha: 'abc123f', message: 'feat: add search bar component', author: 'jason', createdAt: '2024-03-21T08:00:00Z' },
        { sha: 'abc123e', message: 'feat: add useSearch hook', author: 'jason', createdAt: '2024-03-20T15:00:00Z' },
    ],
    45: [
        { sha: 'def456a', message: 'feat: add session sharing', author: 'mager', createdAt: '2024-03-18T12:00:00Z' },
    ],
};

export default function PullRequestDetailScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName, number: numberStr } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();

    const fullName = `${owner}/${repoName}`;
    const prNumber = parseInt(numberStr ?? '0', 10);
    const pulls = getPRsForRepo(fullName);
    const pr = pulls.find((p) => p.number === prNumber);

    if (!pr) {
        return (
            <View style={[styles.container, styles.center]}>
                <Stack.Screen options={{ headerTitle: `#${numberStr}` }} />
                <Ionicons name="git-pull-request-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{ marginTop: 12, fontSize: 15, color: theme.colors.textSecondary }}>
                    {t('lab.pullRequestNotFound')}
                </Text>
            </View>
        );
    }

    const isMerged = pr.status === 'merged';
    const isOpen = pr.status === 'open';
    const statusColor = isMerged ? '#8250DF' : isOpen ? '#34C759' : '#8E8E93';
    const statusBg = isMerged ? '#8250DF15' : isOpen ? '#34C75915' : '#8E8E9315';
    const statusLabel = isMerged ? 'Merged' : isOpen ? 'Open' : 'Closed';

    const files = MOCK_PR_FILES[pr.number] ?? [];
    const commits = MOCK_PR_COMMITS[pr.number] ?? [];

    // Find linked issue if any
    const allIssues = getIssuesForRepo(fullName);
    const linkedIssue = pr.number === 44
        ? allIssues.find((i) => i.linkedPR === pr.number)
        : null;

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: `#${pr.number}` }} />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}>
                {/* Title Card */}
                <View style={styles.titleCard}>
                    <View style={styles.statusRow}>
                        <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                            <Ionicons
                                name={isMerged ? 'git-merge' : isOpen ? 'git-pull-request' : 'close-circle'}
                                size={13}
                                color={statusColor}
                            />
                            <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                        </View>
                        <Text style={styles.prNumber}>#{pr.number}</Text>
                    </View>
                    <Text style={styles.prTitle}>{pr.title}</Text>
                    <View style={styles.metaRow}>
                        <View style={styles.metaItem}>
                            <Ionicons name="person-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.metaText}>@{pr.author}</Text>
                        </View>
                        <Text style={styles.metaText}>·</Text>
                        <Text style={styles.metaText}>
                            {isMerged && pr.mergedAt ? `merged on ${formatDate(pr.mergedAt)}` : `opened on ${formatDate(pr.createdAt)}`}
                        </Text>
                        {pr.headRefName && (
                            <>
                                <Text style={styles.metaText}>·</Text>
                                <View style={styles.branchBadge}>
                                    <Ionicons name="git-branch" size={11} color={theme.colors.textSecondary} />
                                    <Text style={styles.metaText}>{pr.headRefName}</Text>
                                </View>
                            </>
                        )}
                    </View>
                </View>

                {/* Body */}
                {pr.body && (
                    <View style={styles.bodyCard}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.bodyText}>{pr.body}</Text>
                    </View>
                )}

                {/* Linked Issue */}
                {linkedIssue && (
                    <View style={styles.linkedIssueCard}>
                        <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>Linked Issue</Text>
                        <Pressable
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                            onPress={() => router.push(`/repos/${owner}/${repoName}/issue/${linkedIssue.number}`)}
                        >
                            <View style={{ backgroundColor: '#34C75915', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                                <Text style={{ fontSize: 11, fontWeight: '600', color: '#34C759' }}>Open</Text>
                            </View>
                            <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: theme.colors.text }}>
                                #{linkedIssue.number} {linkedIssue.title}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                )}

                {/* Files Changed */}
                {files.length > 0 && (
                    <View style={styles.filesCard}>
                        <Text style={styles.sectionTitle}>
                            Files Changed ({files.length})
                        </Text>
                        {files.map((file, idx) => (
                            <View key={idx} style={[styles.fileItem, idx < files.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
                                <View style={styles.fileIcon}>
                                    <Ionicons
                                        name={file.name.endsWith('.tsx') || file.name.endsWith('.ts') ? 'code-slash' : 'document-outline'}
                                        size={16}
                                        color={theme.colors.textSecondary}
                                    />
                                </View>
                                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                                <View style={styles.fileStats}>
                                    <Text style={styles.insertions}>+{file.insertions}</Text>
                                    <Text style={styles.deletions}>-{file.deletions}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {/* Commits */}
                {commits.length > 0 && (
                    <View style={styles.commitsCard}>
                        <Text style={styles.sectionTitle}>Commits ({commits.length})</Text>
                        {commits.map((commit, idx) => (
                            <View key={idx} style={[styles.commitItem, idx < commits.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
                                <Text style={styles.commitSha}>{commit.sha}</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.commitMessage} numberOfLines={1}>{commit.message}</Text>
                                    <Text style={styles.commitAuthor}>@{commit.author} · {formatTimeAgo(commit.createdAt)}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

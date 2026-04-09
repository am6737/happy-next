import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { BranchSelectSheet } from '@/components/BranchSelectSheet';
import {
    MOCK_REPOS,
    getIssuesForRepo,
    getSessionsForRepo,
    getCommitsForRepo,
    getContributorsForRepo,
    getPRsForRepo,
} from '@/data/mockRepos';
import {
    LANGUAGE_COLORS,
    formatTimeAgo,
    formatNumber,
} from '@/data/repoUtils';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        paddingBottom: 32,
    },
    // Section container
    section: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        overflow: 'hidden',
    },
    // Stats card
    statsCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    readmeCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
    },
    readmeTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 8,
    },
    readmeText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 20,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    statItem: {
        alignItems: 'center',
        flex: 1,
    },
    statValue: {
        fontSize: 18,
        fontWeight: '700',
        color: theme.colors.text,
    },
    statLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    // Nav row (grouped list style)
    navRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    navRowIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    navRowTitle: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        marginLeft: 12,
    },
    navRowBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    navRowBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    // Settings shortcut
    settingsCard: {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    settingsIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgePrivate: {
        backgroundColor: '#FF3B3015',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgePrivateText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#FF3B30',
    },
    badgePublic: {
        backgroundColor: '#34C75915',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgePublicText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#34C759',
    },
}));

export default function RepoDashboardScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const fullName = `${owner}/${repoName}`;
    const repoInfo = MOCK_REPOS.find((r) => r.fullName === fullName);
    const issues = getIssuesForRepo(fullName);
    const sessions = getSessionsForRepo(fullName);
    const commits = getCommitsForRepo(fullName);
    const contributors = getContributorsForRepo(fullName);
    const pulls = getPRsForRepo(fullName);

    const branchSheetRef = React.useRef<BottomSheetModal>(null);
    const [selectedBranch, setSelectedBranch] = React.useState<string>(repoInfo?.defaultBranch ?? 'main');

    const openIssues = issues.filter((i) => i.state === 'open');
    const openPulls = pulls.filter((p) => p.status === 'open');
    const activeSessions = sessions.filter((s) => s.status === 'active');

    if (!repoInfo) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Stack.Screen options={{ headerTitle: t('lab.repoNotFound') }} />
                <Text style={{ fontSize: 16, color: theme.colors.textSecondary }}>{t('lab.repoNotFound')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: repoInfo.fullName }} />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}>
                {/* Stats card */}
                <View style={[styles.statsCard, { marginBottom: 16 }]}>
                    {repoInfo.description && (
                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 12, lineHeight: 18 }} numberOfLines={2}>
                            {repoInfo.description}
                        </Text>
                    )}
                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{formatNumber(repoInfo.stars)}</Text>
                            <Text style={styles.statLabel}>Stars</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{formatNumber(repoInfo.forks)}</Text>
                            <Text style={styles.statLabel}>Forks</Text>
                        </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LANGUAGE_COLORS[repoInfo.language] ?? theme.colors.textSecondary }} />
                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{repoInfo.language}</Text>
                            <View style={repoInfo.isPrivate ? styles.badgePrivate : styles.badgePublic}>
                                <Text style={repoInfo.isPrivate ? styles.badgePrivateText : styles.badgePublicText}>
                                    {repoInfo.isPrivate ? 'Private' : 'Public'}
                                </Text>
                            </View>
                        </View>
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                            Updated {formatTimeAgo(repoInfo.pushedAt)}
                        </Text>
                    </View>
                </View>

                {/* 代码相关：Branch / Code / Commits / Contributors */}
                <View style={[styles.section, { marginBottom: 16 }]}>
                    <Pressable
                        style={styles.navRow}
                        onPress={() => branchSheetRef.current?.present()}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#3178c615' }]}>
                            <Ionicons name="git-branch" size={18} color="#3178c6" />
                        </View>
                        <Text style={styles.navRowTitle}>Branch</Text>
                        <Text style={{ fontSize: 14, color: theme.colors.textSecondary, marginRight: 8 }}>{selectedBranch}</Text>
                        <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                    </Pressable>
                    <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 60 }} />

                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/code?branch=${encodeURIComponent(selectedBranch)}`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#3178c615' }]}>
                            <Ionicons name="code-slash" size={18} color="#3178c6" />
                        </View>
                        <Text style={styles.navRowTitle}>Code</Text>
                    </Pressable>
                    <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 60 }} />

                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/commits?branch=${encodeURIComponent(selectedBranch)}`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#34C75915' }]}>
                            <Ionicons name="git-commit" size={18} color="#34C759" />
                        </View>
                        <Text style={styles.navRowTitle}>Commits</Text>
                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{commits.length}</Text>
                    </Pressable>
                    {contributors.length > 0 && (
                        <>
                            <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 60 }} />
                            <Pressable
                                style={styles.navRow}
                            >
                                <View style={[styles.navRowIcon, { backgroundColor: '#AF52DE15' }]}>
                                    <Ionicons name="people-outline" size={18} color="#AF52DE" />
                                </View>
                                <Text style={styles.navRowTitle}>Contributors</Text>
                                <View style={styles.navRowBadge}>
                                    <Text style={styles.navRowBadgeText}>{contributors.length}</Text>
                                </View>
                            </Pressable>
                        </>
                    )}
                </View>

                {/* 协作相关：Issues / PRs / Sessions */}
                <View style={[styles.section, { marginBottom: 16 }]}>
                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/issues`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#007AFF15' }]}>
                            <Ionicons name="alert-circle-outline" size={18} color="#007AFF" />
                        </View>
                        <Text style={styles.navRowTitle}>Issues</Text>
                        {openIssues.length > 0 && (
                            <View style={styles.navRowBadge}>
                                <Text style={styles.navRowBadgeText}>{openIssues.length}</Text>
                            </View>
                        )}
                    </Pressable>
                    <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 60 }} />

                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/pulls`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#8250DF15' }]}>
                            <Ionicons name="git-pull-request-outline" size={18} color="#8250DF" />
                        </View>
                        <Text style={styles.navRowTitle}>Pull Requests</Text>
                        {openPulls.length > 0 && (
                            <View style={styles.navRowBadge}>
                                <Text style={styles.navRowBadgeText}>{openPulls.length}</Text>
                            </View>
                        )}
                    </Pressable>
                    <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 60 }} />

                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/sessions`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: '#34C75915' }]}>
                            <Ionicons name="chatbubbles-outline" size={18} color="#34C759" />
                        </View>
                        <Text style={styles.navRowTitle}>Sessions</Text>
                        {activeSessions.length > 0 && (
                            <View style={[styles.navRowBadge, { backgroundColor: '#34C75915' }]}>
                                <Text style={[styles.navRowBadgeText, { color: '#34C759' }]}>{activeSessions.length}</Text>
                            </View>
                        )}
                    </Pressable>
                </View>

                {/* Settings */}
                <View style={[styles.section, { marginBottom: 16 }]}>
                    <Pressable
                        style={styles.navRow}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/settings`)}
                    >
                        <View style={[styles.navRowIcon, { backgroundColor: theme.colors.surfaceHighest }]}>
                            <Ionicons name="settings-outline" size={18} color={theme.colors.textSecondary} />
                        </View>
                        <Text style={styles.navRowTitle}>Repository Settings</Text>
                    </Pressable>
                </View>

                {/* README (full) */}
                {repoInfo.readme && (
                    <View style={[styles.readmeCard, { marginTop: 12 }]}>
                        <Text style={styles.readmeText}>{repoInfo.readme}</Text>
                    </View>
                )}
            </ScrollView>

            <BranchSelectSheet
                ref={branchSheetRef}
                branches={repoInfo?.branches ?? []}
                selectedBranch={selectedBranch}
                onSelect={(branch) => setSelectedBranch(branch)}
            />
        </View>
    );
}

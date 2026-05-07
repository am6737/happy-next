import * as React from 'react';
import { View, FlatList, Platform, Pressable, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { Item } from '@/components/Item';
import { getCommitsForRepo, type RepoCommit } from '@/data/mockRepos';
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

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    header: {
        padding: 16,
        paddingBottom: 8,
    },
    headerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 12,
    },
}));

export default function RepoCommitsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
    const fullName = `${owner}/${repo}`;
    const commits = getCommitsForRepo(fullName);

    const renderCommit = ({ item, index }: { item: RepoCommit; index: number }) => (
        <Pressable
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: index < commits.length - 1 ? Platform.select({ ios: 0.33, default: 1 }) : 0,
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surface,
            }}
        >
            <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                    style={{
                        fontSize: 15,
                        color: theme.colors.text,
                        fontWeight: '500',
                        marginBottom: 4,
                        ...Typography.default('semiBold'),
                    }}
                    numberOfLines={2}
                >
                    {item.message}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        ...Typography.mono(),
                    }}>
                        {item.sha}
                    </Text>
                    <Text style={{
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        marginHorizontal: 6,
                    }}>
                        ·
                    </Text>
                    <Text
                        style={{
                            fontSize: 13,
                            color: theme.colors.textSecondary,
                            flex: 1,
                        }}
                        numberOfLines={1}
                    >
                        @{item.author} · {formatTimeAgo(item.createdAt)}
                    </Text>
                </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.groupped?.chevron || theme.colors.textSecondary} />
        </Pressable>
    );

    if (commits.length === 0) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t('commits.title') }} />
                <View style={styles.emptyContainer}>
                    <Ionicons name="git-commit-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('commits.noCommits')}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: t('commits.title') }} />
            <FlatList
                data={commits}
                keyExtractor={(item) => item.sha}
                renderItem={renderCommit}
                contentContainerStyle={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
            />
        </View>
    );
}

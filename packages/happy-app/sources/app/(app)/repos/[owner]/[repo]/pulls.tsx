import * as React from 'react';
import { View, ScrollView, Pressable, FlatList, TextInput } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import {
    getPRsForRepo,
    type RepoPR,
} from '@/data/mockRepos';
import {
    PR_FILTERS,
    formatTimeAgo,
    filterPRs,
    type PRFilter,
} from '@/data/repoUtils';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        position: 'relative',
    },
    filterBar: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    filterChipText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    filterChipTextActive: {
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
    },
    issueCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        padding: 14,
    },
    issueTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    issueMetaText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    emptyText: {
        textAlign: 'center',
        fontSize: 14,
        color: theme.colors.textSecondary,
        paddingVertical: 40,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginLeft: 14,
    },
}));

export default function RepoPullsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const fullName = `${owner}/${repoName}`;
    const pulls = getPRsForRepo(fullName);

    const [prFilter, setPrFilter] = React.useState<PRFilter>('all');
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const searchInputRef = React.useRef<TextInput>(null);
    const headerHeight = 90;

    // Set header title and right buttons
    React.useEffect(() => {
        navigation.setOptions({
            headerTitle: () => searchVisible ? (
                <TextInput
                    ref={searchInputRef}
                    style={{ flex: 1, fontSize: 17, color: theme.colors.text, paddingVertical: 0 }}
                    placeholder="Search pull requests..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoFocus
                    selectionColor="#007AFF"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onBlur={() => {
                        setSearchVisible(false);
                        setSearchQuery('');
                    }}
                />
            ) : (
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.header.tint }}>Pull Requests</Text>
            ),
            headerRight: searchVisible ? undefined : () => (
                <View style={{ flexDirection: 'row', gap: 12, paddingRight: 16, alignItems: 'center' }}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="search-outline" size={22} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={() => {
                        Modal.alert(
                            'Create Pull Request',
                            'Open GitHub to create a new pull request?',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Open GitHub', onPress: () => {
                                    Modal.alert('Coming Soon', 'GitHub PR creation will be available soon.');
                                }},
                            ]
                        );
                    }} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, theme, searchVisible, searchQuery]);

    const filteredPulls = React.useMemo(() => {
        let result = filterPRs(pulls, prFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter((p) =>
                p.title.toLowerCase().includes(q) ||
                String(p.number).includes(q) ||
                p.author.toLowerCase().includes(q)
            );
        }
        return result;
    }, [pulls, prFilter, searchQuery]);

    const renderPullItem = React.useCallback(({ item }: { item: RepoPR }) => {
        const isMerged = item.status === 'merged';
        const isOpen = item.status === 'open';
        const statusColor = isMerged ? '#8250DF' : isOpen ? '#34C759' : '#8E8E93';
        const statusBg = isMerged ? '#8250DF15' : isOpen ? '#34C75915' : '#8E8E9315';

        return (
            <Pressable
                style={styles.issueCard}
                onPress={() => router.push(`/repos/${owner}/${repoName}/pulls/${item.number}`)}
            >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ backgroundColor: statusBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 2 }}>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: statusColor }}>
                            {isMerged ? 'Merged' : isOpen ? 'Open' : 'Closed'}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                            <Text style={styles.issueMetaText}>
                                #{item.number} by @{item.author}
                            </Text>
                            {item.headRefName && (
                                <>
                                    <Text style={styles.issueMetaText}>·</Text>
                                    <Ionicons name="git-branch" size={11} color={theme.colors.textSecondary} />
                                    <Text style={styles.issueMetaText}>{item.headRefName}</Text>
                                </>
                            )}
                        </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                </View>
            </Pressable>
        );
    }, [router, owner, repoName, styles, theme]);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: 'Pull Requests', headerBackTitle: t('common.back') }} />

            {searchVisible && (
                <Pressable
                    style={{ position: 'absolute', top: headerHeight, left: 0, right: 0, bottom: 0, zIndex: 1 }}
                    onPress={() => {
                        searchInputRef.current?.blur();
                        setSearchVisible(false);
                        setSearchQuery('');
                    }}
                />
            )}

            <View style={{ flex: 1 }}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexGrow: 0, flexShrink: 0 }}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
                >
                    {PR_FILTERS.map((f) => {
                        const count = f.key === 'all' ? pulls.length
                            : f.key === 'open' ? pulls.filter((p) => p.status === 'open').length
                            : f.key === 'merged' ? pulls.filter((p) => p.status === 'merged').length
                            : pulls.filter((p) => p.status === 'closed').length;
                        return (
                            <Pressable
                                key={f.key}
                                style={[styles.filterChip, prFilter === f.key && styles.filterChipActive]}
                                onPress={() => setPrFilter(f.key)}
                            >
                                <Text style={[styles.filterChipText, prFilter === f.key && styles.filterChipTextActive]}>
                                    {f.label} ({count})
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <View style={[{ marginHorizontal: 16, marginBottom: 16, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surface }]}>
                    <FlatList
                        data={filteredPulls}
                        keyExtractor={(item) => String(item.number)}
                        renderItem={renderPullItem}
                        ItemSeparatorComponent={() => <View style={styles.divider} />}
                        contentContainerStyle={[
                            { paddingBottom: 24 },
                            filteredPulls.length === 0 && { flex: 1 },
                        ]}
                        ListEmptyComponent={<Text style={styles.emptyText}>No pull requests match the current filter</Text>}
                    />
                </View>
            </View>
        </View>
    );
}

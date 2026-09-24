import * as React from 'react';
import { View, Pressable, FlatList, ActivityIndicator, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { type RepoIssue } from '@/data/mockRepos';
import { useGithubIssues } from '@/hooks/useGithubData';
import {
    ISSUE_FILTERS,
    filterIssues,
    type IssueFilter,
} from '@/data/repoUtils';
import {
    IssueCard,
    FilterChipRow,
    RepoSearchBar,
    RepoEmptyState,
    IssueListSkeleton,
} from '@/components/repos';
import { IssueIcon } from '@/components/repos/IssueIcon';
import { t } from '@/text';
import { softHeaderOptions, useSoftHeaderInset } from '@/components/navigation/softHeader';
import { isRunningOnMac } from '@/utils/platform';

export default function RepoIssuesScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();
    const softHeaderInset = useSoftHeaderInset();
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();

    const { data: issues, loading: issuesLoading, loadingMore, hasMore, loadMore, refresh: refreshIssues } = useGithubIssues(owner!, repoName!, 'all');
    const lastRefreshRef = React.useRef(0);
    useFocusEffect(React.useCallback(() => {
        const now = Date.now();
        if (now - lastRefreshRef.current > 60_000) {
            lastRefreshRef.current = now;
            refreshIssues();
        }
    }, [refreshIssues]));

    const [issueFilter, setIssueFilter] = React.useState<IssueFilter>('open');
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [fixedHeaderHeight, setFixedHeaderHeight] = React.useState(0);

    React.useEffect(() => {
        navigation.setOptions({
            ...softHeaderOptions,
            headerTitle: searchVisible ? '' : t('repository.issues'),
            headerRight: searchVisible ? undefined : () => (
                <View style={styles.headerRight}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={8} style={styles.headerBtn}>
                        <Ionicons name="search" size={21} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={() => router.push(`/repos/${owner}/${repoName}/issue/new`)} hitSlop={8} style={styles.headerBtn}>
                        <Ionicons name="add" size={24} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, owner, repoName, theme, router, searchVisible, styles]);

    const filteredIssues = React.useMemo(() => {
        let result = filterIssues(issues, issueFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter((i) =>
                i.title.toLowerCase().includes(q) ||
                String(i.number).includes(q) ||
                i.author.toLowerCase().includes(q)
            );
        }
        return result;
    }, [issues, issueFilter, searchQuery]);

    const filtersWithCount = React.useMemo(() =>
        ISSUE_FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count: f.key === 'all' ? issues.length
                : f.key === 'open' ? issues.filter((i) => i.state === 'open').length
                : issues.filter((i) => i.state === 'closed').length,
        })),
    [issues]);

    const renderIssueItem = React.useCallback(({ item, index }: { item: RepoIssue; index: number }) => {
        return (
            <IssueCard
                data={item}
                onPress={() => router.push(`/repos/${owner}/${repoName}/issue/${item.number}`)}
                showDivider={index < filteredIssues.length - 1}
            />
        );
    }, [router, owner, repoName, filteredIssues.length]);

    const fixedControls = (
        <>
            {searchVisible ? (
                <RepoSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('repository.searchIssuesPlaceholder')}
                    expanded
                    onExpand={() => setSearchVisible(true)}
                    onCollapse={() => { setSearchVisible(false); setSearchQuery(''); }}
                    cancelLabel={t('common.cancel')}
                />
            ) : null}
            <FilterChipRow filters={filtersWithCount} value={issueFilter} onChange={setIssueFilter} />
        </>
    );

    const list = (
        <FlatList
            style={useNativeSoftHeader ? styles.listWrap : undefined}
            contentInsetAdjustmentBehavior="automatic"
            data={issuesLoading && issues.length === 0 ? [] : filteredIssues}
            keyExtractor={(item) => String(item.number)}
            renderItem={renderIssueItem}
            ListHeaderComponent={useNativeSoftHeader ? <View style={{ height: fixedHeaderHeight + 4 }} /> : undefined}
            ListEmptyComponent={issuesLoading && issues.length === 0 ? (
                <IssueListSkeleton count={5} />
            ) : (
                <RepoEmptyState
                    iconElement={<IssueIcon size={24} color={theme.colors.textSecondary} />}
                    title={t('repository.emptyIssuesTitle')}
                    subtitle={t('repository.emptyIssuesSubtitle')}
                />
            )}
            contentContainerStyle={{ paddingBottom: 24 }}
            onEndReached={hasMore ? loadMore : undefined}
            onEndReachedThreshold={0.5}
            ListFooterComponent={loadingMore ? (
                <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
            ) : null}
        />
    );

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ ...softHeaderOptions, headerBackTitle: t('common.back') }} />
            {useNativeSoftHeader ? (
                <>
                    {list}
                    <View
                        style={[styles.fixedHeader, { top: softHeaderInset }]}
                        onLayout={(event) => setFixedHeaderHeight(event.nativeEvent.layout.height)}
                    >
                        {fixedControls}
                    </View>
                </>
            ) : (
                <>
                    {fixedControls}
                    {issuesLoading && issues.length === 0 ? (
                        <IssueListSkeleton count={5} />
                    ) : filteredIssues.length === 0 ? (
                        <RepoEmptyState
                            iconElement={<IssueIcon size={24} color={theme.colors.textSecondary} />}
                            title={t('repository.emptyIssuesTitle')}
                            subtitle={t('repository.emptyIssuesSubtitle')}
                        />
                    ) : (
                        <View style={[styles.listWrap, { marginTop: 4 }]}>{list}</View>
                    )}
                </>
            )}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    listWrap: {
        flex: 1,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    fixedHeader: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
    },
    headerBtn: {
        padding: 4,
    },
}));

import * as React from 'react';
import { View, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { SearchField } from '@/components/SearchField';
import { SessionHistoryCard } from '@/components/SessionHistoryCard';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/auth/AuthContext';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useAllSessions } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';
import { t } from '@/text';
import {
    dismissSharedContent,
    sendSharedContentTo,
    setSharePageOpen,
    useSharedContentStore,
    type SharedContent,
} from '@/share/sharedContent';

function summarize(content: SharedContent): string {
    const images = content.files.filter((file) => file.mimeType.startsWith('image/')).length;
    const videos = content.files.filter((file) => file.mimeType.startsWith('video/')).length;
    const files = content.files.length - images - videos;
    const parts: string[] = [];
    if (images) parts.push(t('shareTarget.images', { count: images }));
    if (videos) parts.push(t('shareTarget.videos', { count: videos }));
    if (files) parts.push(t('shareTarget.files', { count: files }));
    return parts.join(' · ');
}

/**
 * Where another app's share sheet leads: what was shared, and the places it can go — a new
 * session or one of the online ones. Picking one opens its composer with the content filled in
 * (useSharedContentIntake); leaving without a pick drops it.
 */
export default React.memo(function ShareTargetScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const { isAuthenticated } = useAuth();
    const navigateToSession = useNavigateToSession();
    const content = useSharedContentStore((state) => state.content);
    const allSessions = useAllSessions();
    const [searchQuery, setSearchQuery] = React.useState('');

    React.useEffect(() => {
        setSharePageOpen(true);
        return () => {
            setSharePageOpen(false);
            dismissSharedContent();
        };
    }, []);

    // Online sessions of one's own: a shared-in session may not take attachments
    const sessions = React.useMemo(() => {
        const active = allSessions.filter((session) => session.active && !session.accessLevel);
        const query = searchQuery.trim().toLowerCase();
        if (!query) return active;
        return active.filter((session) =>
            getSessionName(session).toLowerCase().includes(query) ||
            getSessionSubtitle(session).toLowerCase().includes(query));
    }, [allSessions, searchQuery]);

    const handleNewSession = React.useCallback(() => {
        sendSharedContentTo({ type: 'new' });
        router.back();
        router.navigate('/new', { dangerouslySingular: () => 'new' });
    }, [router]);

    const handleSession = React.useCallback((session: Session) => {
        sendSharedContentTo({ type: 'session', sessionId: session.id });
        router.back();
        navigateToSession(session.id);
    }, [router, navigateToSession]);

    const renderItem = React.useCallback(({ item, index }: { item: Session; index: number }) => (
        <SessionHistoryCard
            session={item}
            isSingle={sessions.length === 1}
            isFirst={index === 0}
            isLast={index === sessions.length - 1}
            onPress={handleSession}
        />
    ), [sessions.length, handleSession]);

    if (!isAuthenticated) {
        return <Redirect href="/" />;
    }

    if (!content) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator color={theme.colors.textSecondary} />
            </View>
        );
    }

    const summary = summarize(content);
    const header = (
        <View>
            <View style={styles.preview}>
                {content.text && (
                    <Text style={styles.previewText} numberOfLines={3}>{content.text}</Text>
                )}
                {summary.length > 0 && (
                    <Text style={styles.previewSummary}>{summary}</Text>
                )}
            </View>
            <Pressable style={styles.newSession} onPress={handleNewSession}>
                <View style={styles.newSessionIcon}>
                    <Ionicons name="add" size={26} color={theme.colors.button.primary.tint} />
                </View>
                <Text style={styles.newSessionText}>{t('shareTarget.newSession')}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.groupped.chevron} />
            </Pressable>
            <Text style={styles.sectionTitle}>{t('shareTarget.activeSessions')}</Text>
            <View style={styles.searchContainer}>
                <SearchField
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('shareTarget.searchPlaceholder')}
                />
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={sessions}
                    contentInsetAdjustmentBehavior="automatic"
                    keyboardShouldPersistTaps="handled"
                    renderItem={renderItem}
                    keyExtractor={(session) => session.id}
                    ListHeaderComponent={header}
                    ListEmptyComponent={
                        <Text style={styles.emptyText}>
                            {searchQuery.trim() ? t('shareTarget.noResults') : t('shareTarget.noActiveSessions')}
                        </Text>
                    }
                    contentContainerStyle={{ paddingTop: 8, paddingBottom: safeArea.bottom + 16 }}
                />
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.groupped.background,
    },
    preview: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        marginHorizontal: 16,
        marginBottom: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 4,
    },
    previewText: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
    },
    previewSummary: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    newSession: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        marginHorizontal: 16,
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    newSessionIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    newSessionText: {
        flex: 1,
        marginLeft: 16,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    sectionTitle: {
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 24,
        fontSize: 14,
        letterSpacing: 0.1,
        color: theme.colors.groupped.sectionTitle,
        ...Typography.default('semiBold'),
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    emptyText: {
        paddingTop: 24,
        paddingHorizontal: 32,
        fontSize: 16,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

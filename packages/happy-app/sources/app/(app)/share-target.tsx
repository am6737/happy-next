import * as React from 'react';
import { View, FlatList, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { SearchField } from '@/components/SearchField';
import { Avatar } from '@/components/Avatar';
import { ChatHeaderTitle } from '@/components/ChatHeaderTitle';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/auth/AuthContext';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useAllMachines, useAllSessions } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { getSessionAvatarId, getSessionName } from '@/utils/sessionUtils';
import { isRunningOnMac } from '@/utils/platform';
import { compareSessionsByLastMessage } from '@/utils/sessionLastMessageAt';
import { machineNames, shareSessionSubtitle } from '@/share/shareSessionSubtitle';
import { t } from '@/text';
import {
    dismissSharedContent,
    sendSharedContentTo,
    setSharePageOpen,
    useSharedContentStore,
    type SharedContent,
} from '@/share/sharedContent';

function describe(content: SharedContent): string {
    const images = content.files.filter((file) => file.mimeType.startsWith('image/')).length;
    const videos = content.files.filter((file) => file.mimeType.startsWith('video/')).length;
    const files = content.files.length - images - videos;
    if (content.text && !content.files.length) {
        const line = content.text.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
        return line ? `${t('shareTarget.text')} · “${line}”` : t('shareTarget.text');
    }
    const parts: string[] = [];
    if (content.text) parts.push(t('shareTarget.text'));
    if (images) parts.push(t('shareTarget.images', { count: images }));
    if (videos) parts.push(t('shareTarget.videos', { count: videos }));
    if (files === 1 && !images && !videos) {
        parts.push(content.files[0].name);
    } else if (files) {
        parts.push(t('shareTarget.files', { count: files }));
    }
    return parts.join(' · ');
}

type Row = { session: Session; subtitle: string };

const SessionRow = React.memo((props: { row: Row; first: boolean; onPress: (session: Session) => void }) => {
    const { session, subtitle } = props.row;
    return (
        <View>
            {!props.first && <View style={styles.divider} />}
            <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => props.onPress(session)}
            >
                <Avatar id={getSessionAvatarId(session)} size={40} hideBadges />
                <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{getSessionName(session)}</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
                </View>
                <View style={styles.onlineDot} />
            </Pressable>
        </View>
    );
});

/**
 * Where another app's share sheet leads, laid out like the iOS share extension's sheet: what was
 * shared under the title, a search field, a new session and the online sessions (project, AI and
 * machine under each). Picking one opens its composer with the content filled in
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
    const machines = useAllMachines();
    const [searchQuery, setSearchQuery] = React.useState('');
    const searching = searchQuery.trim().length > 0;

    React.useEffect(() => {
        setSharePageOpen(true);
        return () => {
            setSharePageOpen(false);
            dismissSharedContent();
        };
    }, []);

    // Online sessions of one's own (a shared-in session may not take attachments), in the session
    // list's order
    const rows = React.useMemo(() => {
        const names = machineNames(machines);
        return allSessions
            .filter((session) => session.active && !session.accessLevel)
            .sort(compareSessionsByLastMessage)
            .map((session) => ({ session, subtitle: shareSessionSubtitle(session, names) }));
    }, [allSessions, machines]);

    const shown = React.useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return rows;
        return rows.filter((row) =>
            getSessionName(row.session).toLowerCase().includes(query) ||
            row.subtitle.toLowerCase().includes(query));
    }, [rows, searchQuery]);

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

    const renderItem = React.useCallback(({ item, index }: { item: Row; index: number }) => (
        <SessionRow row={item} first={index === 0} onPress={handleSession} />
    ), [handleSession]);

    const title = t('shareTarget.sheetTitle', { app: Constants.expoConfig?.name ?? 'Happy' });
    const subtitle = content ? describe(content) : '';
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();
    const screenOptions = useNativeSoftHeader
        ? { headerTitle: title, headerSubtitle: subtitle || undefined, headerSubtitleColor: theme.colors.textSecondary }
        : { headerTitle: () => <ChatHeaderTitle title={title} subtitle={subtitle || undefined} /> };

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

    const header = (
        <View>
            <View style={styles.searchContainer}>
                <SearchField
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('shareTarget.searchPlaceholder')}
                />
            </View>
            {!searching && (
                <>
                    <Pressable
                        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                        onPress={handleNewSession}
                    >
                        <View style={styles.newSessionIcon}>
                            <Ionicons name="add" size={24} color={theme.colors.button.primary.tint} />
                        </View>
                        <Text style={styles.newSessionText}>{t('shareTarget.newSession')}</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                    <Text style={styles.sectionTitle}>{t('shareTarget.activeSessions')}</Text>
                </>
            )}
        </View>
    );

    return (
        <View style={styles.container}>
            <Stack.Screen options={screenOptions} />
            <View style={styles.contentContainer}>
                <FlatList
                    data={shown}
                    contentInsetAdjustmentBehavior="automatic"
                    keyboardShouldPersistTaps="handled"
                    renderItem={renderItem}
                    keyExtractor={(row) => row.session.id}
                    ListHeaderComponent={header}
                    ListEmptyComponent={
                        <Text style={styles.emptyText}>
                            {searching ? t('shareTarget.noResults') : t('shareTarget.noActiveSessions')}
                        </Text>
                    }
                    contentContainerStyle={{ paddingBottom: safeArea.bottom + 16 }}
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
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    rowPressed: {
        backgroundColor: theme.colors.sessionList.rowHover,
    },
    newSessionIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    newSessionText: {
        flex: 1,
        fontSize: 16,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    sectionTitle: {
        paddingTop: 16,
        paddingBottom: 4,
        paddingHorizontal: 16,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 16 + 40 + 12,
        backgroundColor: theme.colors.divider,
    },
    rowText: {
        flex: 1,
        gap: 2,
    },
    rowTitle: {
        fontSize: 16,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    rowSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    onlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 8,
        backgroundColor: theme.colors.status.connected,
    },
    emptyText: {
        paddingTop: 24,
        paddingHorizontal: 32,
        fontSize: 15,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

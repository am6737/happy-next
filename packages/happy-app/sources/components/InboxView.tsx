import * as React from 'react';
import { View, Text, ScrollView, RefreshControl, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAcceptedFriends, useFriendRequests, useRequestedFriends, useFeedItems, useFeedLoaded, useFriendsLoaded, useRealtimeStatus, useDootaskProfile } from '@/sync/storage';
import { UserCard } from '@/components/UserCard';
import type { UserProfile } from '@/sync/friendTypes';
import { useFriendActions } from '@/hooks/useFriendActions';
import { t } from '@/text';
import { trackFriendsProfileView } from '@/track';
import { Item } from '@/components/Item';
import { UpdateBanner } from './UpdateBanner';
import { Typography } from '@/constants/Typography';
import { useFocusEffect, useRouter } from 'expo-router';
import { layout } from '@/components/layout';
import { useIsTablet } from '@/utils/responsive';
import { Image } from 'expo-image';
import { FeedItemCard } from './FeedItemCard';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { sync } from '@/sync/sync';
import { dootaskFetchUsers, dootaskFetchDialogs, dootaskOpenUserDialog } from '@/sync/dootask/api';
import type { DooTaskProfile, DooTaskUser, DooTaskDialogListItem } from '@/sync/dootask/types';
import { showToast } from './Toast';
import { useMainTabBottomPadding } from '@/hooks/useMainTabBottomPadding';
import { loadDooTaskInboxUsersCache, saveDooTaskInboxUsersCache } from '@/sync/persistence';
import { FLAT_ROW_AVATAR_SIZE, FLAT_ROW_RADIUS, flatRowIconContainerStyle, flatRowItemStyle, flatRowSubtitleStyle, flatRowTitleStyle } from './flatRow';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyTitle: {
        fontSize: 20,
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 16,
        ...Typography.default(),
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
    },
    // Sections lie flat on the background like the session list's projects: a header, then rows
    // inset and rounded, without a card or dividers.
    section: {
        marginBottom: 8,
    },
    sectionHeader: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    sectionHeaderText: {
        fontSize: 13,
        ...Typography.default('medium'),
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    row: {
        marginHorizontal: 8,
        marginBottom: 4,
        borderRadius: FLAT_ROW_RADIUS,
        overflow: 'hidden',
    },
}));

function InboxSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
            {React.Children.map(children, (child) => (
                <View style={styles.row}>
                    {React.isValidElement(child)
                        ? React.cloneElement(child as React.ReactElement<{ showDivider?: boolean; flat?: boolean }>, { showDivider: false, flat: true })
                        : child}
                </View>
            ))}
        </View>
    );
}

// A person in the inbox, whose relationship's actions are its long-press (or right-click) menu.
function InboxUserRow({ user, showDivider, flat }: { user: UserProfile; showDivider?: boolean; flat?: boolean }) {
    const router = useRouter();
    const { menuItems } = useFriendActions(user);
    return (
        <UserCard
            user={user}
            showDivider={showDivider}
            flat={flat}
            menuItems={menuItems}
            onPress={() => {
                trackFriendsProfileView();
                router.push(`/user/${user.id}`);
            }}
        />
    );
}

// The first section's title stands as far under the header as the session list's first project name
// (its 12 of top padding and half its 44 header, against half this list's 32).
const INBOX_TOP_PADDING = 12 + 44 / 2 - 32 / 2;

interface InboxViewProps {
}

function resolveDootaskUrl(serverUrl: string, path?: string | null): string | null {
    if (!path) return null;
    const base = serverUrl.replace(/\/+$/, '') + '/';
    const resolved = path.replace(/\{\{RemoteURL\}\}/g, base);
    return resolved.startsWith('http') ? resolved : base + resolved.replace(/^\/+/, '');
}

function extractDootaskUsers(data: any): DooTaskUser[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.list)) return data.list;
    return [];
}

function extractDootaskDialogs(data: any): DooTaskDialogListItem[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.list)) return data.list;
    return [];
}

function parseDootaskTime(value?: string | null): number {
    if (!value) return 0;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

type DootaskMergedUser = DooTaskUser & {
    dialogId?: number;
    lastAtMs?: number;
};

let dootaskInboxCache: {
    key: string;
    users: DootaskMergedUser[];
} | null = null;

function dootaskChatPath(dialogId: number, user: DootaskMergedUser, profile: DooTaskProfile): string {
    const params = new URLSearchParams();
    const title = user.nickname || user.email || `#${user.userid}`;
    const avatar = resolveDootaskUrl(profile.serverUrl, user.userimg);
    params.set('kind', 'user');
    params.set('title', title);
    params.set('userId', String(user.userid));
    if (avatar) params.set('avatar', avatar);
    return `/dootask/chat/${dialogId}?${params.toString()}`;
}

async function openDootaskChat(profile: DooTaskProfile, dootaskUser: DootaskMergedUser, router: ReturnType<typeof useRouter>) {
    const res = await dootaskOpenUserDialog(profile.serverUrl, profile.token, dootaskUser.userid);
    if (res.ret === 1 && res.data?.id) {
        router.push(dootaskChatPath(res.data.id, dootaskUser, profile) as any);
        return true;
    }
    return false;
}

export const InboxView = React.memo(({}: InboxViewProps) => {
    const router = useRouter();
    const friends = useAcceptedFriends();
    const friendRequests = useFriendRequests();
    const requestedFriends = useRequestedFriends();
    const feedItems = useFeedItems();
    const feedLoaded = useFeedLoaded();
    const friendsLoaded = useFriendsLoaded();
    const { theme } = useUnistyles();
    const isTablet = useIsTablet();
    const realtimeStatus = useRealtimeStatus();
    const dootaskProfile = useDootaskProfile();
    const tabBottomPadding = useMainTabBottomPadding();

    const [refreshing, setRefreshing] = React.useState(false);
    const [dootaskUsers, setDootaskUsers] = React.useState<DootaskMergedUser[]>([]);
    const [dootaskUsersLoading, setDootaskUsersLoading] = React.useState(false);
    const [openingDootaskUserId, setOpeningDootaskUserId] = React.useState<number | null>(null);

    const loadDootaskUsers = React.useCallback(async () => {
        if (!dootaskProfile) {
            setDootaskUsers([]);
            setDootaskUsersLoading(false);
            return;
        }
        const profileKey = `${dootaskProfile.serverUrl}|${dootaskProfile.userId}`;
        const cachedUsers = dootaskInboxCache?.key === profileKey
            ? dootaskInboxCache.users
            : loadDooTaskInboxUsersCache(profileKey);
        if (cachedUsers) {
            setDootaskUsers(cachedUsers);
        }
        setDootaskUsersLoading(!cachedUsers);
        try {
            const [dialogResult, userResult] = await Promise.allSettled([
                dootaskFetchDialogs(dootaskProfile.serverUrl, dootaskProfile.token, { page: 1, pagesize: 100 }),
                dootaskFetchUsers(dootaskProfile.serverUrl, dootaskProfile.token, { page: 1, pagesize: 100 }),
            ]);
            const cur = dootaskProfile;
            if (`${cur.serverUrl}|${cur.userId}` !== profileKey) return;
            if (userResult.status !== 'fulfilled' || userResult.value.ret !== 1) {
                if (!cachedUsers) {
                    setDootaskUsers([]);
                }
                return;
            }

            const recentMap = new Map<number, { dialogId: number; lastAtMs: number }>();
            if (dialogResult.status === 'fulfilled' && dialogResult.value.ret === 1) {
                const dialogs = extractDootaskDialogs(dialogResult.value.data);
                for (const dialog of dialogs) {
                    if (dialog.type !== 'user') continue;
                    const dialogUserId = dialog.dialog_user?.userid;
                    if (!dialogUserId || dialogUserId === dootaskProfile.userId) continue;
                    const lastAtMs = parseDootaskTime(dialog.last_at ?? dialog.user_at ?? null);
                    const dialogId = dialog.id;
                    const current = recentMap.get(dialogUserId);
                    if (!current || lastAtMs > current.lastAtMs) {
                        recentMap.set(dialogUserId, { dialogId, lastAtMs });
                    }
                }
            }

            const users = extractDootaskUsers(userResult.value.data)
                .map((user, index) => {
                    const recent = recentMap.get(user.userid);
                    return {
                        ...user,
                        dialogId: recent?.dialogId,
                        lastAtMs: recent?.lastAtMs,
                        __index: index,
                    } as DootaskMergedUser & { __index: number };
                });

            users.sort((a, b) => {
                const aTime = a.lastAtMs ?? 0;
                const bTime = b.lastAtMs ?? 0;
                if (aTime !== bTime) return bTime - aTime;
                return a.__index - b.__index;
            });

            const mergedUsers = users.map(({ __index, ...rest }) => rest);
            dootaskInboxCache = {
                key: profileKey,
                users: mergedUsers,
            };
            saveDooTaskInboxUsersCache(profileKey, mergedUsers);
            setDootaskUsers(mergedUsers);
        } catch {
            if (!cachedUsers) {
                setDootaskUsers([]);
            }
        } finally {
            setDootaskUsersLoading(false);
        }
    }, [dootaskProfile]);

    useFocusEffect(
        React.useCallback(() => {
            loadDootaskUsers();
        }, [loadDootaskUsers])
    );

    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                sync.refreshInbox(),
                loadDootaskUsers(),
            ]);
        } finally {
            setRefreshing(false);
        }
    }, [loadDootaskUsers]);

    const openDootaskForUser = React.useCallback(async (dootaskUser: DootaskMergedUser, fallback?: () => void) => {
        if (!dootaskProfile || openingDootaskUserId !== null) {
            fallback?.();
            return;
        }
        setOpeningDootaskUserId(dootaskUser.userid);
        try {
            if (dootaskUser.dialogId) {
                router.push(dootaskChatPath(dootaskUser.dialogId, dootaskUser, dootaskProfile) as any);
                return true;
            }
            const ok = await openDootaskChat(dootaskProfile, dootaskUser, router);
            if (!ok) {
                fallback?.();
                if (!fallback) showToast(t('dootask.errorLoadChat'));
            }
        } catch {
            fallback?.();
            if (!fallback) showToast(t('dootask.errorLoadChat'));
        } finally {
            setOpeningDootaskUserId(null);
        }
    }, [dootaskProfile, openingDootaskUserId, router]);

    const dootaskInitialLoadPending = !!dootaskProfile && dootaskUsersLoading && dootaskUsers.length === 0;
    const isEmpty = feedLoaded && friendsLoaded && !dootaskInitialLoadPending && friendRequests.length === 0 && requestedFriends.length === 0 && friends.length === 0 && feedItems.length === 0 && dootaskUsers.length === 0;

    const refreshControl = (
        <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.textSecondary}
        />
    );

    const statusBar = isTablet && realtimeStatus !== 'disconnected' ? (
        <VoiceAssistantStatusBar variant="full" />
    ) : null;

    if (isEmpty) {
        return (
            <View style={styles.container}>
                {statusBar}
                <ScrollView
                    contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: tabBottomPadding }}
                    refreshControl={refreshControl}
                >
                    <UpdateBanner />
                    <View style={styles.emptyContainer}>
                        <Image
                            source={require('@/assets/images/brutalist/Brutalism 10.png')}
                            contentFit="contain"
                            style={{ width: 64, height: 64, marginBottom: 16 }}
                            tintColor={theme.colors.textSecondary}
                        />
                        <Text style={styles.emptyTitle}>{t('inbox.emptyTitle')}</Text>
                        <Text style={styles.emptyDescription}>{t('inbox.emptyDescription')}</Text>
                    </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {statusBar}
            <ScrollView
                contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                contentContainerStyle={{
                    flexGrow: 1,
                    maxWidth: layout.maxWidth,
                    alignSelf: 'center',
                    width: '100%',
                    paddingTop: INBOX_TOP_PADDING,
                    paddingBottom: tabBottomPadding,
                }}
                refreshControl={refreshControl}
            >
                <UpdateBanner />

                {feedItems.length > 0 && (
                    <>
                        <InboxSection title={t('inbox.updates')}>
                            {feedItems.map((item) => (
                                <FeedItemCard
                                    key={item.id}
                                    item={item}
                                />
                            ))}
                        </InboxSection>
                    </>
                )}

                {friendRequests.length > 0 && (
                    <>
                        <InboxSection title={t('friends.pendingRequests')}>
                            {friendRequests.map((friend) => (
                                <InboxUserRow key={friend.id} user={friend} />
                            ))}
                        </InboxSection>
                    </>
                )}

                {requestedFriends.length > 0 && (
                    <>
                        <InboxSection title={t('friends.requestPending')}>
                            {requestedFriends.map((friend) => (
                                <InboxUserRow key={friend.id} user={friend} />
                            ))}
                        </InboxSection>
                    </>
                )}

                {friends.length > 0 && (
                    <>
                        <InboxSection title={t('friends.myFriends')}>
                            {friends.map((friend) => (
                                <InboxUserRow key={friend.id} user={friend} />
                            ))}
                        </InboxSection>
                    </>
                )}

                {dootaskUsers.length > 0 && dootaskProfile && (
                    <InboxSection title={t('dootask.title')}>
                        {dootaskUsers.map((user) => (
                            <DooTaskUserCard
                                key={user.userid}
                                user={user}
                                profile={dootaskProfile}
                                loading={openingDootaskUserId === user.userid}
                                onPress={() => openDootaskForUser(user)}
                            />
                        ))}
                    </InboxSection>
                )}
            </ScrollView>
        </View>
    );
});

function DooTaskUserCard({ user, profile, onPress, loading, showDivider, flat }: {
    user: DootaskMergedUser;
    profile: DooTaskProfile;
    onPress: () => void;
    loading?: boolean;
    showDivider?: boolean;
    flat?: boolean;
}) {
    const displayName = user.nickname || user.email || `#${user.userid}`;
    const subtitle = user.profession || user.email || `#${user.userid}`;
    const avatarUrl = resolveDootaskUrl(profile.serverUrl, user.userimg);

    return (
        <Item
            title={displayName}
            subtitle={subtitle}
            subtitleLines={1}
            leftElement={
                <Image
                    source={avatarUrl ? { uri: avatarUrl } : require('@/assets/images/icon-dootask.png')}
                    contentFit="cover"
                    style={flat
                        ? { width: FLAT_ROW_AVATAR_SIZE, height: FLAT_ROW_AVATAR_SIZE, borderRadius: FLAT_ROW_AVATAR_SIZE / 2 }
                        : { width: 40, height: 40, borderRadius: 20 }}
                />
            }
            style={flat ? flatRowItemStyle : undefined}
            titleStyle={flat ? flatRowTitleStyle : undefined}
            subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
            iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
            onPress={onPress}
            loading={loading}
            showChevron
            showDivider={showDivider}
        />
    );
}

import * as React from 'react';
import { View, Text, ScrollView, RefreshControl, Platform, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAcceptedFriends, useFriendRequests, useRequestedFriends, useFeedItems, useFeedLoaded, useFriendsLoaded, useRealtimeStatus, useDootaskProfile } from '@/sync/storage';
import { UserCard } from '@/components/UserCard';
import { getCurrentLanguage, t } from '@/text';
import { trackFriendsProfileView } from '@/track';
import { ItemGroup } from '@/components/ItemGroup';
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
import { AiGroupAvatar, AiIdentityAvatar } from '@/features/aiTeams/components';
import { getAiTeamCopy } from '@/features/aiTeams/copy';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import type { AiAgent, AiChatMessage, AiConversation } from '@/features/aiTeams/mockData';

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
    emptyIcon: {
        marginBottom: 16,
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
    sectionHeader: {
        fontSize: 14,
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 24,
        paddingBottom: 8,
        textTransform: 'uppercase',
    },
    aiConversationRow: {
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    aiConversationPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    aiConversationBody: {
        flex: 1,
        minWidth: 0,
    },
    aiConversationTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    aiConversationTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 21,
        flex: 1,
        minWidth: 0,
    },
    aiConversationTitleUnread: {
        fontWeight: '700',
    },
    aiConversationTime: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
        flexShrink: 0,
    },
    aiConversationPreview: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        minWidth: 0,
    },
    aiConversationSender: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        flexShrink: 0,
        maxWidth: 92,
    },
    aiConversationAiBadge: {
        marginLeft: 5,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceHighest,
    },
    aiConversationAiText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textLink,
        fontSize: 9,
        lineHeight: 12,
    },
    aiConversationPreviewText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        flex: 1,
        minWidth: 0,
    },
    aiConversationUnreadDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        marginLeft: 8,
        backgroundColor: theme.colors.textLink,
        flexShrink: 0,
    },
    aiConversationDivider: {
        height: Platform.select({ ios: StyleSheet.hairlineWidth, default: 0 }),
        marginLeft: 72,
        backgroundColor: theme.colors.divider,
    },
}));

type AiConversationListItemProps = {
    conversation: AiConversation;
    agents: AiAgent[];
    messages: AiChatMessage[];
    onPress: () => void;
    showDivider?: boolean;
};

function AiConversationListItem({ conversation, agents, messages, onPress, showDivider = true }: AiConversationListItemProps) {
    const latestMessage = messages.at(-1);
    const latestIsAgent = latestMessage?.sender === 'agent';
    const latestAgent = latestIsAgent
        ? agents.find((agent) => agent.id === (latestMessage.agentId ?? conversation.agentId))
        : undefined;
    const members = agents.filter((agent) => conversation.participantAgentIds.includes(agent.id));
    const senderName = latestIsAgent
        ? latestAgent?.name ?? conversation.title
        : getCurrentLanguage().startsWith('zh') ? '你' : 'You';

    return (
        <>
            <Pressable style={({ pressed }) => [styles.aiConversationRow, pressed && styles.aiConversationPressed]} onPress={onPress}>
                {conversation.kind === 'group' ? (
                    <AiGroupAvatar members={members} size={44} />
                ) : (
                    <AiIdentityAvatar id={conversation.agentId} name={conversation.title} size={44} />
                )}
                <View style={styles.aiConversationBody}>
                    <View style={styles.aiConversationTop}>
                        <Text style={[styles.aiConversationTitle, conversation.unread && styles.aiConversationTitleUnread]} numberOfLines={1}>{conversation.title}</Text>
                        <Text style={styles.aiConversationTime}>{conversation.timeLabel}</Text>
                    </View>
                    <View style={styles.aiConversationPreview}>
                        {conversation.kind === 'group' && latestMessage ? (
                            <>
                                <Text style={styles.aiConversationSender} numberOfLines={1}>{senderName}</Text>
                                {latestIsAgent ? <View style={styles.aiConversationAiBadge}><Text style={styles.aiConversationAiText}>AI</Text></View> : null}
                                <Text style={styles.aiConversationPreviewText} numberOfLines={1}>：{conversation.lastMessage}</Text>
                            </>
                        ) : (
                            <Text style={styles.aiConversationPreviewText} numberOfLines={1}>{conversation.lastMessage}</Text>
                        )}
                        {conversation.unread ? <View style={styles.aiConversationUnreadDot} /> : null}
                    </View>
                </View>
            </Pressable>
            {showDivider ? <View style={styles.aiConversationDivider} /> : null}
        </>
    );
}

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
    const aiTeamData = useManagedAiTeamData();
    const aiTeamCopy = getAiTeamCopy();

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
    const isEmpty = feedLoaded && friendsLoaded && !dootaskInitialLoadPending && friendRequests.length === 0 && requestedFriends.length === 0 && friends.length === 0 && feedItems.length === 0 && dootaskUsers.length === 0 && aiTeamData.conversations.length === 0;

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
                            style={[{ width: 64, height: 64 }, styles.emptyIcon]}
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
                    paddingBottom: tabBottomPadding,
                }}
                refreshControl={refreshControl}
            >
                <UpdateBanner />

                <ItemGroup title={aiTeamCopy.inboxTitle}>
                    {aiTeamData.conversations.map((conversation) => (
                        <AiConversationListItem
                            key={conversation.id}
                            conversation={conversation}
                            agents={aiTeamData.agents}
                            messages={aiTeamData.messages[conversation.id] ?? []}
                            onPress={() => router.push(`/inbox/ai/${conversation.id}` as never)}
                        />
                    ))}
                </ItemGroup>

                {feedItems.length > 0 && (
                    <>
                        <ItemGroup title={t('inbox.updates')}>
                            {feedItems.map((item) => (
                                <FeedItemCard
                                    key={item.id}
                                    item={item}
                                />
                            ))}
                        </ItemGroup>
                    </>
                )}

                {friendRequests.length > 0 && (
                    <>
                        <ItemGroup title={t('friends.pendingRequests')}>
                            {friendRequests.map((friend) => (
                                <UserCard
                                    key={friend.id}
                                    user={friend}
                                    onPress={() => {
                                        trackFriendsProfileView();
                                        router.push(`/user/${friend.id}`);
                                    }}
                                />
                            ))}
                        </ItemGroup>
                    </>
                )}

                {requestedFriends.length > 0 && (
                    <>
                        <ItemGroup title={t('friends.requestPending')}>
                            {requestedFriends.map((friend) => (
                                <UserCard
                                    key={friend.id}
                                    user={friend}
                                    onPress={() => {
                                        trackFriendsProfileView();
                                        router.push(`/user/${friend.id}`);
                                    }}
                                />
                            ))}
                        </ItemGroup>
                    </>
                )}

                {friends.length > 0 && (
                    <>
                        <ItemGroup title={t('friends.myFriends')}>
                            {friends.map((friend) => (
                                <UserCard
                                    key={friend.id}
                                    user={friend}
                                    onPress={() => {
                                        trackFriendsProfileView();
                                        router.push(`/user/${friend.id}`);
                                    }}
                                />
                            ))}
                        </ItemGroup>
                    </>
                )}

                {dootaskUsers.length > 0 && dootaskProfile && (
                    <ItemGroup title={t('dootask.title')}>
                        {dootaskUsers.map((user) => (
                            <DooTaskUserCard
                                key={user.userid}
                                user={user}
                                profile={dootaskProfile}
                                loading={openingDootaskUserId === user.userid}
                                onPress={() => openDootaskForUser(user)}
                            />
                        ))}
                    </ItemGroup>
                )}
            </ScrollView>
        </View>
    );
});

function DooTaskUserCard({ user, profile, onPress, loading }: {
    user: DootaskMergedUser;
    profile: DooTaskProfile;
    onPress: () => void;
    loading?: boolean;
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
                    style={{ width: 40, height: 40, borderRadius: 20 }}
                />
            }
            iconContainerStyle={{ marginRight: 20 }}
            onPress={onPress}
            loading={loading}
            showChevron
        />
    );
}

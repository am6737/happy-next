import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FeedItem } from '@/sync/feedTypes';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { useUser, storage } from '@/sync/storage';
import { useAuth } from '@/auth/AuthContext';
import { Avatar } from './Avatar';
import { Item } from './Item';
import { deleteFeedItem } from '@/sync/apiFeed';
import { getDisplayName } from '@/sync/friendTypes';
import { ActionMenuItem } from './ActionMenu';
import { RowContextMenu, type RowLongPressProps } from './RowContextMenu';
import { FLAT_ROW_AVATAR_SIZE, flatRowIconContainerStyle, flatRowItemStyle, flatRowSubtitleStyle, useFlatRowTitleStyle } from './flatRow';

interface FeedItemCardProps {
    item: FeedItem;
    showDivider?: boolean;
    // Laid flat on the background, as the inbox lists it.
    flat?: boolean;
}

export const FeedItemCard = React.memo(({ item, showDivider, flat }: FeedItemCardProps) => {
    const { theme } = useUnistyles();
    const flatRowTitleStyle = useFlatRowTitleStyle();
    const router = useRouter();
    const { credentials } = useAuth();

    // Get user profile from global users cache for friend-related items
    // User MUST exist for friend-related items or they would have been filtered out
    const user = useUser(
        (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')
            ? item.body.uid
            : undefined
    );

    const getTimeAgo = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('time.justNow');
        if (minutes < 60) return t('time.minutesAgo', { count: minutes });
        if (hours < 24) return t('time.hoursAgo', { count: hours });
        return t('sessionHistory.daysAgo', { count: days });
    };

    const handleDelete = React.useCallback(() => {
        // Optimistic removal
        storage.getState().removeFeedItem(item.id);
        // Fire and forget server deletion
        if (credentials) {
            deleteFeedItem(credentials, item.id).catch(console.error);
        }
    }, [item.id, credentials]);

    const menuItems = React.useMemo<ActionMenuItem[]>(() => [{
        label: t('inbox.deleteNotification'),
        destructive: true,
        icon: { ionicon: 'trash-outline', sfSymbol: 'trash' },
        onPress: handleDelete,
    }], [handleDelete]);
    const renderContent = (longPressProps: RowLongPressProps) => {
        switch (item.body.kind) {
            case 'friend_request': {
                const avatarElement = user!.avatar ? (
                    <Avatar
                        id={user!.id}
                        imageUrl={user!.avatar.url}
                        size={flat ? FLAT_ROW_AVATAR_SIZE : 40}
                    />
                ) : (
                    <Ionicons name="person" size={20} color={theme.colors.textSecondary} />
                );

                return (
                    <Item
                        title={t('feed.friendRequestFrom', { name: getDisplayName(user!) })}
                        subtitle={getTimeAgo(item.createdAt)}
                        leftElement={avatarElement}
                        style={flat ? flatRowItemStyle : undefined}
                        titleStyle={flat ? flatRowTitleStyle : undefined}
                        subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
                        iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
                        onPress={() => router.push(`/user/${user!.id}`)}
                        showChevron={true}
                        showDivider={showDivider}
                        {...longPressProps}
                    />
                );
            }

            case 'friend_accepted': {
                const avatarElement = user!.avatar ? (
                    <Avatar
                        id={user!.id}
                        imageUrl={user!.avatar.url}
                        size={flat ? FLAT_ROW_AVATAR_SIZE : 40}
                    />
                ) : (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.status.connected} />
                );

                return (
                    <Item
                        title={t('feed.friendAccepted', { name: getDisplayName(user!) })}
                        subtitle={getTimeAgo(item.createdAt)}
                        leftElement={avatarElement}
                        style={flat ? flatRowItemStyle : undefined}
                        titleStyle={flat ? flatRowTitleStyle : undefined}
                        subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
                        iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
                        onPress={() => router.push(`/user/${user!.id}`)}
                        showChevron={true}
                        showDivider={showDivider}
                        {...longPressProps}
                    />
                );
            }

            case 'text':
                return (
                    <Item
                        title={item.body.text}
                        subtitle={getTimeAgo(item.createdAt)}
                        icon={<Ionicons name="information-circle" size={20} color={theme.colors.textSecondary} />}
                        style={flat ? flatRowItemStyle : undefined}
                        titleStyle={flat ? flatRowTitleStyle : undefined}
                        subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
                        iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
                        showChevron={false}
                        showDivider={showDivider}
                        {...longPressProps}
                    />
                );

            case 'notice':
                return (
                    <Item
                        title={item.body.title}
                        subtitle={getTimeAgo(item.createdAt)}
                        icon={
                            <View>
                                <Ionicons name="notifications" size={20} color={theme.colors.textLink} />
                                {item.badge && <View style={styles.badgeDot} />}
                            </View>
                        }
                        style={flat ? flatRowItemStyle : undefined}
                        titleStyle={flat ? flatRowTitleStyle : undefined}
                        subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
                        iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
                        onPress={() => router.push({ pathname: '/inbox/notice/[id]', params: { id: item.id } })}
                        showChevron={true}
                        showDivider={showDivider}
                        {...longPressProps}
                    />
                );

            default:
                return null;
        }
    };

    return (
        <RowContextMenu items={menuItems} flat={flat}>
            {renderContent}
        </RowContextMenu>
    );
});

const styles = StyleSheet.create((theme) => ({
    badgeDot: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.status.error,
    },
}));

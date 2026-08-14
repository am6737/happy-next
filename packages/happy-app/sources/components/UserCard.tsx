import React from 'react';
import { UserProfile, getDisplayName, getUsernameLabel } from '@/sync/friendTypes';
import { Item } from '@/components/Item';
import { Avatar } from '@/components/Avatar';

interface UserCardProps {
    user: UserProfile;
    onPress?: () => void;
    showDivider?: boolean;
}

export function UserCard({
    user,
    onPress,
    showDivider,
}: UserCardProps) {
    const displayName = getDisplayName(user);
    const avatarUrl = user.avatar?.url || user.avatar?.path;

    // Create avatar element using the Avatar component
    const avatarElement = (
        <Avatar
            id={user.id}
            size={40}
            imageUrl={avatarUrl}
            thumbhash={user.avatar?.thumbhash}
        />
    );

    const subtitle = getUsernameLabel(user);

    return (
        <Item
            title={displayName}
            subtitle={subtitle}
            subtitleLines={1}
            leftElement={avatarElement}
            iconContainerStyle={{ marginRight: 20 }}
            onPress={onPress}
            showChevron={!!onPress}
            showDivider={showDivider}
        />
    );
}

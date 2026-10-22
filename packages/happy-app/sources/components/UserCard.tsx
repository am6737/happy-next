import React from 'react';
import { UserProfile, getDisplayName, getUsernameLabel } from '@/sync/friendTypes';
import { Item } from '@/components/Item';
import { Avatar } from '@/components/Avatar';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { RowContextMenu } from '@/components/RowContextMenu';
import { FLAT_ROW_AVATAR_SIZE, flatRowIconContainerStyle, flatRowItemStyle, flatRowSubtitleStyle, useFlatRowTitleStyle } from '@/components/flatRow';

interface UserCardProps {
    user: UserProfile;
    onPress?: () => void;
    showDivider?: boolean;
    // Laid flat on the background, as the inbox lists it.
    flat?: boolean;
    // Its actions, as a long-press (or right-click) menu.
    menuItems?: ActionMenuItem[];
}

export function UserCard({
    user,
    onPress,
    showDivider,
    flat,
    menuItems,
}: UserCardProps) {
    const flatRowTitleStyle = useFlatRowTitleStyle();
    const displayName = getDisplayName(user);
    const avatarUrl = user.avatar?.url || user.avatar?.path;

    // Create avatar element using the Avatar component
    const avatarElement = (
        <Avatar
            id={user.id}
            size={flat ? FLAT_ROW_AVATAR_SIZE : 40}
            imageUrl={avatarUrl}
            thumbhash={user.avatar?.thumbhash}
        />
    );

    const subtitle = getUsernameLabel(user);

    return (
        <RowContextMenu items={menuItems ?? []} flat={flat}>
            {(longPressProps) => (
                <Item
                    title={displayName}
                    subtitle={subtitle}
                    subtitleLines={1}
                    leftElement={avatarElement}
                    style={flat ? flatRowItemStyle : undefined}
                    titleStyle={flat ? flatRowTitleStyle : undefined}
                    subtitleStyle={flat ? flatRowSubtitleStyle : undefined}
                    iconContainerStyle={flat ? flatRowIconContainerStyle : { marginRight: 20 }}
                    onPress={onPress}
                    showChevron={!!onPress}
                    showDivider={showDivider}
                    {...longPressProps}
                />
            )}
        </RowContextMenu>
    );
}

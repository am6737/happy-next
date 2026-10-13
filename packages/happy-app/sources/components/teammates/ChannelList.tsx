import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Channel, Teammate } from 'happy-wire';
import { storage, useChannels } from '@/sync/storage';
import { channelUnread } from '@/sync/channelReducers';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { TeammateAvatar } from './ui';

export function channelTitle(channel: Channel): string {
    if (channel.kind === 'group') return channel.title || t('channels.group');
    const id = channel.members.find(m => m.memberType === 'teammate')?.teammateId;
    return (id && storage.getState().teammates[id]?.name) || t('channels.unknownAgent');
}

/** A DM shows its Agent; a group overlaps its first two members, like a group chat avatar. */
export function ChannelAvatar({ members, size = 40 }: { members: Teammate[]; size?: number }) {
    if (members.length < 2) return <TeammateAvatar teammate={members[0] ?? { avatar: null }} size={size} />;
    const small = Math.round(size * 0.7);
    return (
        <View style={{ width: size, height: size }}>
            <TeammateAvatar teammate={members[0]} size={small} />
            <View style={[styles.groupAvatarBack, { borderRadius: small / 2 + 2 }]}>
                <TeammateAvatar teammate={members[1]} size={small} />
            </View>
        </View>
    );
}

/** The DM's Agent in the chat header, opening its profile. Groups have none. */
export function ChannelHeaderAvatar({ id }: { id: string }) {
    const router = useRouter();
    const teammate = storage(state => {
        const channel = state.channels[id];
        const teammateId = channel?.kind === 'dm' ? channel.members.find(m => m.memberType === 'teammate')?.teammateId : undefined;
        return teammateId ? state.teammates[teammateId] : undefined;
    });
    if (!teammate) return null;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.profile')} hitSlop={15} onPress={() => router.push(`/teammates/${teammate.id}`)}>
            <TeammateAvatar teammate={teammate} size={32} />
        </Pressable>
    );
}
/** Opens group info while preserving the Agent avatar entry for DMs. */
export function ChannelSettingsButton({ id }: { id: string }) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const channel = storage(state => state.channels[id]);
    if (!channel || channel.kind !== 'group') return <ChannelHeaderAvatar id={id} />;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('channels.settings.title')}
            hitSlop={15}
            onPress={() => router.push(`/channels/${id}/settings`)}
        >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
        </Pressable>
    );
}

/** `bare` drops the new-group action and titles the group by source ("Agent"), like the DooTask group, for use inside the Inbox. */
export function ChannelList({ bare = false }: { bare?: boolean }) {
    const router = useRouter();
    const channels = useChannels();
    const teammates = storage(state => state.teammates);
    const accountId = storage(state => state.profile.id);
    return (
        <ItemGroup
            title={bare ? t('tabs.teammates') : t('channels.chats')}
            headerAction={bare ? undefined : { label: t('channels.newGroup'), onPress: () => router.push('/channels/new') }}
        >
            {!channels.length && <Item title={t('channels.empty')} titleStyle={styles.emptyTitle} />}
            {channels.map(channel => {
                const members = channel.members.flatMap(m => m.teammateId && teammates[m.teammateId] ? [teammates[m.teammateId]] : []);
                const unread = channelUnread(channel, accountId);
                const subtitle = channel.kind === 'dm' ? (members[0]?.role ?? '') : members.map(m => m.name).join(', ');
                return (
                    <Item
                        key={channel.id}
                        title={channelTitle(channel)}
                        subtitle={subtitle || undefined}
                        subtitleLines={1}
                        leftElement={<ChannelAvatar members={channel.kind === 'dm' ? members.slice(0, 1) : members} />}
                        rightElement={unread > 0 ? (
                            <View accessibilityLabel={t('channels.unread', { count: unread })} style={styles.badge}>
                                <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                            </View>
                        ) : undefined}
                        showChevron
                        onPress={() => router.push(`/channels/${channel.id}`)}
                    />
                );
            })}
        </ItemGroup>
    );
}

const styles = StyleSheet.create((theme) => ({
    groupAvatarBack: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        borderWidth: 2,
        borderColor: theme.colors.surface,
    },
    emptyTitle: {
        color: theme.colors.textSecondary,
        fontSize: 15,
    },
    badge: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    badgeText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.button.primary.tint,
    },
}));

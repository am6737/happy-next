import * as React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { getAiAgentPresenceLabel, type AiAgentAvailability, type AiAgentPresence } from './agentPresence';

export function getAiAvatarColor(_id: string): string {
    return '#5C6BC0';
}

function avatarInitial(name: string): string {
    const characters = Array.from(name.trim());
    if (characters.length === 0) return '?';
    return characters.slice(0, 2).join('').toUpperCase();
}

const stylesheet = StyleSheet.create((theme) => ({
    avatar: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: theme.colors.surfaceHigh,
    },
    avatarText: {
        color: theme.colors.text,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    statusDot: {
        width: 7,
        height: 7,
        borderRadius: 999,
    },
    statusText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    teamAvatar: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
}));

export function AiIdentityAvatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
    const styles = stylesheet;
    const initials = avatarInitial(name);
    const characterCount = Array.from(initials).length;
    return (
        <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}> 
            <Text style={[styles.avatarText, { fontSize: size * (characterCount > 1 ? 0.3 : 0.38) }]}>{initials}</Text>
        </View>
    );
}

export function AiTeamAvatar({ size = 48 }: { size?: number }) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    return (
        <View style={[styles.teamAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
            <Ionicons name="people-outline" size={size * 0.52} color={theme.colors.textSecondary} />
        </View>
    );
}

export function AiGroupAvatar({ members, size = 44 }: { members: Array<{ id: string; name: string }>; size?: number }) {
    const { theme } = useUnistyles();
    const visibleMembers = members.slice(0, 2);
    const memberSize = Math.round(size * 0.7);

    if (visibleMembers.length < 2) {
        const member = visibleMembers[0] ?? { id: 'group', name: '群' };
        return <AiIdentityAvatar id={member.id} name={member.name} size={size} />;
    }

    return (
        <View style={{ width: size, height: size }}>
            <View style={{ position: 'absolute', left: 0, top: 0 }}>
                <AiIdentityAvatar id={visibleMembers[0].id} name={visibleMembers[0].name} size={memberSize} />
            </View>
            <View style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                borderRadius: memberSize / 2 + 2,
                borderWidth: 2,
                borderColor: theme.colors.surface,
            }}>
                <AiIdentityAvatar id={visibleMembers[1].id} name={visibleMembers[1].name} size={memberSize} />
            </View>
        </View>
    );
}


function availabilityColor(availability: AiAgentAvailability, theme: ReturnType<typeof useUnistyles>['theme']): string {
    switch (availability) {
        case 'online': return theme.colors.success;
        case 'unstable': return '#FF9500';
        case 'offline':
        case 'archived': return theme.colors.textSecondary;
    }
}

export function AiAgentPresenceDot({ availability, size = 8 }: { availability: AiAgentAvailability; size?: number }) {
    const { theme } = useUnistyles();
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: availabilityColor(availability, theme) }} />
    );
}

export function AiAgentPresencePill({ presence, isZh }: { presence: AiAgentPresence; isZh: boolean }) {
    const styles = stylesheet;
    return (
        <View style={styles.status}>
            <AiAgentPresenceDot availability={presence.availability} size={7} />
            <Text style={styles.statusText}>{getAiAgentPresenceLabel(presence, isZh)}</Text>
        </View>
    );
}

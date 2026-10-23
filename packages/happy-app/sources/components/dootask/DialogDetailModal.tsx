import * as React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { SearchField } from '@/components/SearchField';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { SHEET_ITEM_GROUP_STYLE, sheetFill, sheetSafeAreaBottom } from '@/components/glassSheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { formatLastSeen } from '@/utils/sessionUtils';
import type { DooTaskDialogUser, DooTaskUser } from '@/sync/dootask/types';

const AVATAR_SIZE = 40;
const HEADER_AVATAR_SIZE = 72;

function resolveAvatarUrl(avatarPath: string | null | undefined, serverUrl: string): string | null {
    if (!avatarPath) return null;
    const base = serverUrl.replace(/\/+$/, '') + '/';
    const resolved = avatarPath.replace(/\{\{RemoteURL\}\}/g, base);
    if (resolved.startsWith('http') || resolved.startsWith('//')) return resolved;
    return base + resolved.replace(/^\/+/, '');
}

/** Map DooTask group_type values to localized labels. */
function getGroupTypeLabel(groupType: string): string {
    switch (groupType) {
        case 'all': return t('dootask.groupTypeAll');
        case 'department': return t('dootask.groupTypeDepartment');
        case 'project': return t('dootask.groupTypeProject');
        case 'task': return t('dootask.groupTypeTask');
        case 'okr': return t('dootask.groupTypeOkr');
        case 'user': return t('dootask.groupTypeUser');
        default: return groupType;
    }
}

/** DooTask's "YYYY-MM-DD HH:mm:ss", read as local time; null when there is none. */
function parseDootaskTime(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : null;
}

type DialogDetailModalProps = {
    /** A one-to-one chat shows the other person's card; a group shows its info and members. */
    isUserDialog: boolean;
    dialogName: string;
    dialogId: number;
    /** The other person's avatar in a one-to-one chat, already resolved. */
    dialogAvatar: string | null;
    groupType: string;
    ownerId: number;
    /** The other person in a one-to-one chat, when known. */
    peerUserId: number | null;
    /** The other person's `users/basic`, which has what the member list lacks: department, last online. */
    peerProfile: DooTaskUser | null;
    currentUserId: number;
    email: string | null;
    isBot: boolean;
    members: DooTaskDialogUser[];
    loading: boolean;
    serverUrl: string;
};

export const DialogDetailModal = React.memo(React.forwardRef<BottomSheetModal, DialogDetailModalProps>((props, ref) => {
    const [search, setSearch] = React.useState('');

    // Reset search when sheet dismisses
    const handleDismiss = React.useCallback(() => {
        setSearch('');
    }, []);

    return (
        <AppBottomSheet
            ref={ref}
            snapPoints={props.isUserDialog ? undefined : ['60%', '80%']}
            enableDynamicSizing={props.isUserDialog}
            onDismiss={handleDismiss}
        >
            {props.isUserDialog
                ? <UserDialogDetail {...props} />
                : <GroupDialogDetail {...props} search={search} onSearchChange={setSearch} />}
        </AppBottomSheet>
    );
}));

/** The other person's card: who they are, whether they are around, and how to reach them. */
const UserDialogDetail = React.memo(function UserDialogDetail({
    dialogName, dialogAvatar, peerUserId, peerProfile, currentUserId, email, isBot, members, serverUrl,
}: DialogDetailModalProps) {
    const insets = useSafeAreaInsets();
    const member = React.useMemo(() => (
        members.find(u => u.userid === peerUserId)
        ?? members.find(u => u.userid !== currentUserId)
        ?? null
    ), [members, peerUserId, currentUserId]);

    const name = peerProfile?.nickname || member?.nickname || dialogName;
    const avatar = resolveAvatarUrl(peerProfile?.userimg || member?.userimg, serverUrl) || dialogAvatar;
    const bot = isBot || !!peerProfile?.bot || !!member?.bot;
    const online = peerProfile?.online ?? member?.online;
    const lastOnlineAt = parseDootaskTime(peerProfile?.line_at);
    const status = online
        ? t('status.online')
        : lastOnlineAt !== null
            ? t('dootask.lastOnline', { time: formatLastSeen(lastOnlineAt) })
            : online === false ? t('status.offline') : null;

    const profession = peerProfile?.profession || member?.profession;
    const department = peerProfile?.department_name;
    const mail = email || peerProfile?.email;

    return (
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: sheetSafeAreaBottom(insets.bottom) + 16 }}>
            <View style={cardStyles.header}>
                {avatar ? (
                    <Image source={{ uri: avatar }} style={{ width: HEADER_AVATAR_SIZE, height: HEADER_AVATAR_SIZE, borderRadius: HEADER_AVATAR_SIZE / 2 }} contentFit="cover" />
                ) : (
                    <View style={cardStyles.avatarPlaceholder}>
                        <Text style={cardStyles.avatarInitial}>{(name || '?')[0].toUpperCase()}</Text>
                    </View>
                )}
                <Text style={cardStyles.name} numberOfLines={2}>{name}</Text>
                {bot ? (
                    <View style={cardStyles.tag}>
                        <Text style={cardStyles.tagText}>{t('dootask.bot')}</Text>
                    </View>
                ) : status ? (
                    <View style={cardStyles.statusRow}>
                        <View style={[cardStyles.statusDot, online ? cardStyles.statusDotOnline : cardStyles.statusDotOffline]} />
                        <Text style={cardStyles.status}>{status}</Text>
                    </View>
                ) : null}
            </View>
            <ItemGroup containerStyle={SHEET_ITEM_GROUP_STYLE}>
                <Item title={t('dootask.profession')} detail={profession || '-'} copy={profession || false} showChevron={false} />
                <Item title={t('dootask.department')} detail={department || '-'} copy={department || false} showChevron={false} />
                <Item title={t('dootask.email')} detail={mail || '-'} copy={mail || false} showChevron={false} />
            </ItemGroup>
        </BottomSheetScrollView>
    );
});

/** A group's name, id and kind, then its searchable members. */
const GroupDialogDetail = React.memo(function GroupDialogDetail({
    dialogName, dialogId, groupType, ownerId, members, loading, serverUrl, search, onSearchChange,
}: DialogDetailModalProps & { search: string; onSearchChange: (text: string) => void }) {
    const { theme } = useUnistyles();

    const filtered = React.useMemo(() => {
        if (!search.trim()) return members;
        const q = search.toLowerCase();
        return members.filter(u => u.nickname?.toLowerCase().includes(q));
    }, [members, search]);

    const renderMember = React.useCallback(({ item }: { item: DooTaskDialogUser }) => {
        const avatarUrl = resolveAvatarUrl(item.userimg, serverUrl);
        const isOwner = item.userid === ownerId;
        const isDisabled = !!item.disable_at;
        return (
            <View style={memberStyles.row}>
                <View style={memberStyles.avatarWrap}>
                    {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }}
                            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, opacity: isDisabled ? 0.4 : 1 }}
                        />
                    ) : (
                        <View style={[memberStyles.avatarPlaceholder, { backgroundColor: sheetFill(theme.colors.surface), opacity: isDisabled ? 0.4 : 1 }]}>
                            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>
                                {(item.nickname || '?')[0].toUpperCase()}
                            </Text>
                        </View>
                    )}
                </View>
                <Text style={[memberStyles.name, { color: isDisabled ? theme.colors.textSecondary : theme.colors.text }]} numberOfLines={1}>
                    {item.nickname}
                </Text>
                {isOwner ? (
                    <View style={memberStyles.ownerBadge}>
                        <Text style={memberStyles.ownerText}>{t('dootask.groupOwner')}</Text>
                    </View>
                ) : null}
            </View>
        );
    }, [serverUrl, ownerId, theme]);

    const groupTypeLabel = getGroupTypeLabel(groupType);

    const ListHeaderComponent = React.useMemo(() => (
        <>
            {/* Dialog info */}
            <View style={sheetStyles.infoSection}>
                <Text style={[sheetStyles.label, { color: theme.colors.textSecondary }]}>{t('dootask.dialogName')}</Text>
                <Text style={[sheetStyles.value, { color: theme.colors.text }]}>{dialogName}</Text>

                <Text style={[sheetStyles.label, { color: theme.colors.textSecondary, marginTop: 16 }]}>{t('dootask.dialogId')}</Text>
                <Text style={[sheetStyles.value, { color: theme.colors.text }]}>{dialogId}</Text>

                <Text style={[sheetStyles.label, { color: theme.colors.textSecondary, marginTop: 16 }]}>{t('dootask.groupType')}</Text>
                <Text style={[sheetStyles.value, { color: theme.colors.text }]}>{groupTypeLabel}</Text>
            </View>

            {/* Search */}
            <SearchField
                inSheet
                value={search}
                onChangeText={onSearchChange}
                placeholder={t('dootask.searchMembers')}
                style={sheetStyles.searchField}
            />
        </>
    ), [theme, dialogName, dialogId, groupTypeLabel, search, onSearchChange]);

    if (loading && members.length === 0) {
        return (
            <View style={{ flex: 1, alignItems: 'center', paddingTop: 40 }}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }

    return (
        <BottomSheetFlatList
            data={filtered}
            keyExtractor={(item: DooTaskDialogUser) => String(item.userid)}
            renderItem={renderMember}
            ListHeaderComponent={ListHeaderComponent}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
        />
    );
});

const cardStyles = StyleSheet.create((theme) => ({
    header: {
        alignItems: 'center',
        paddingHorizontal: theme.margins.lg,
        paddingTop: theme.margins.md,
        paddingBottom: theme.margins.sm,
        gap: 4,
    },
    avatarPlaceholder: {
        width: HEADER_AVATAR_SIZE,
        height: HEADER_AVATAR_SIZE,
        borderRadius: HEADER_AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: sheetFill(theme.colors.surfaceHighest),
    },
    avatarInitial: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        color: theme.colors.text,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        textAlign: 'center',
        marginTop: 8,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusDotOnline: {
        backgroundColor: theme.colors.status.connected,
    },
    statusDotOffline: {
        backgroundColor: theme.colors.status.disconnected,
    },
    status: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    tag: {
        marginTop: 2,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: sheetFill(theme.colors.surfaceHighest),
    },
    tagText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));

const sheetStyles = StyleSheet.create((theme) => ({
    infoSection: {
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.md,
    },
    label: {
        ...Typography.default(),
        fontSize: 13,
    },
    value: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        marginTop: 2,
    },
    searchField: {
        marginHorizontal: theme.margins.lg,
        marginVertical: theme.margins.md,
    },
}));

const memberStyles = StyleSheet.create((_theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: _theme.margins.lg,
        paddingVertical: 12,
        gap: 12,
    },
    avatarWrap: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
    },
    avatarPlaceholder: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    name: {
        ...Typography.default(),
        fontSize: 15,
        flex: 1,
    },
    ownerBadge: {
        backgroundColor: '#4CAF50',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    ownerText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: '#FFFFFF',
    },
}));

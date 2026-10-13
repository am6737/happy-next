import * as React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Teammate } from 'happy-wire';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { storage } from '@/sync/storage';
import { useChannelActions } from '@/hooks/useChannelActions';
import { useChannelBrief } from '@/hooks/useChannelBrief';
import { ChannelAddMembersSheet } from '@/components/teammates/ChannelAddMembersSheet';
import { TeammateSheet, useTeammateSheet } from '@/components/teammates/TeammateSheet';
import { TeammateAvatar } from '@/components/teammates/ui';
import { ChannelAvatar } from '@/components/teammates/ChannelList';
import { ChannelBriefField } from '@/components/teammates/ChannelBriefField';
import { Card, FieldError, KIT_PAGE_PADDING, PillButton, Row, SectionLabel, SheetTextInput } from '@/components/teammates/kit';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const MAX_MEMBERS = 20;

function MemberCell({ teammate, editing, onPress }: { teammate: Teammate; editing: boolean; onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={editing ? t('channels.settings.confirmRemove', { name: teammate.name }) : teammate.name}
            onPress={onPress} style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
            <View>
                <TeammateAvatar teammate={teammate} size={48} />
                {editing && (
                    <View style={styles.minusBadge}>
                        <Ionicons name="remove" size={14} color="#FFFFFF" />
                    </View>
                )}
            </View>
            <Text style={styles.cellLabel} numberOfLines={1}>{teammate.name}</Text>
        </Pressable>
    );
}

function ActionCell({ icon, label, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; disabled: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
            style={({ pressed }) => [styles.cell, disabled && styles.disabled, pressed && styles.pressed]}>
            <View style={styles.actionCircle}>
                <Ionicons name={icon} size={22} color={theme.colors.textSecondary} />
            </View>
            <Text style={styles.cellLabel} numberOfLines={1}>{label}</Text>
        </Pressable>
    );
}

export default React.memo(function ChannelSettingsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const channel = storage(state => state.channels[id]);
    const teammates = storage(state => state.teammates);
    const actions = useChannelActions(id);
    const brief = useChannelBrief(channel);
    const addSheet = useTeammateSheet();
    const renameSheet = useTeammateSheet();
    const [editing, setEditing] = React.useState(false);
    const [title, setTitle] = React.useState('');

    const memberIds = React.useMemo(() => channel?.members.flatMap(member => member.memberType === 'teammate' && member.teammateId ? [member.teammateId] : []) ?? [], [channel]);
    const members = memberIds.flatMap(memberId => teammates[memberId] ? [teammates[memberId]] : []);
    const canRemove = memberIds.length > 1;

    // The chat was deleted, here or elsewhere: there is nothing left to configure.
    React.useEffect(() => {
        if (!channel) router.back();
    }, [channel, router]);
    React.useEffect(() => {
        if (!canRemove) setEditing(false);
    }, [canRemove]);

    if (!channel) return null;

    const openRename = () => {
        setTitle(channel.title ?? '');
        renameSheet.present();
    };
    const saveTitle = async () => {
        if (await actions.rename(title.trim())) renameSheet.dismiss();
    };

    return (
        <View style={styles.page}>
            <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                <View style={styles.header}>
                    <View style={styles.avatar}>
                        <ChannelAvatar members={members} size={64} />
                    </View>
                    <Text style={styles.title} numberOfLines={2}>{channel.title || t('channels.group')}</Text>
                    <Text style={styles.subtitle}>{t('channels.settings.count', { count: memberIds.length })}</Text>
                </View>

                <SectionLabel title={t('channels.settings.members')} />
                <Card style={styles.grid}>
                    {members.map(member => (
                        <MemberCell
                            key={member.id}
                            teammate={member}
                            editing={editing}
                            onPress={() => editing ? void actions.removeMember(member) : router.push(`/teammates/${member.id}`)}
                        />
                    ))}
                    {!editing && (
                        <ActionCell icon="add" label={t('channels.settings.add')} disabled={actions.busy || memberIds.length >= MAX_MEMBERS} onPress={addSheet.present} />
                    )}
                    <ActionCell
                        icon={editing ? 'checkmark' : 'remove'}
                        label={editing ? t('channels.settings.done') : t('channels.settings.remove')}
                        disabled={!editing && (actions.busy || !canRemove)}
                        onPress={() => setEditing(value => !value)}
                    />
                </Card>

                <ChannelBriefField value={brief} busy={actions.busy} error={actions.error} onSave={actions.updateBrief} />

                <Card style={styles.card}>
                    <Row label={t('channels.settings.groupName')} value={channel.title || t('channels.group')} onPress={openRename} disabled={actions.busy} />
                    <Row label={t('channels.settings.startNewContext')} onPress={() => void actions.reset()} disabled={actions.busy} />
                </Card>

                <FieldError message={actions.error} />

                <Pressable accessibilityRole="button" disabled={actions.busy} onPress={() => void actions.remove()}
                    style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
                    <Text style={styles.deleteText}>{t('channels.settings.deleteGroup')}</Text>
                </Pressable>
            </ScrollView>

            <ChannelAddMembersSheet ref={addSheet.ref} memberIds={memberIds} remaining={MAX_MEMBERS - memberIds.length} busy={actions.busy} onAdd={actions.addMembers} />
            <TeammateSheet ref={renameSheet.ref} title={t('channels.settings.rename')}>
                <SheetTextInput
                    accessibilityLabel={t('channels.settings.groupName')}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={100}
                    editable={!actions.busy}
                    placeholder={t('channels.groupTitlePlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    style={[styles.input, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                />
                <FieldError message={actions.error} />
                <PillButton label={t('channels.settings.save')} disabled={!title.trim() || title.trim() === channel.title} loading={actions.busy} onPress={saveTitle} />
            </TeammateSheet>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
    },
    header: {
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 8,
        gap: 4,
    },
    avatar: {
        marginBottom: 8,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        textAlign: 'center',
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 16,
        paddingVertical: 16,
    },
    cell: {
        width: '20%',
        alignItems: 'center',
        gap: 6,
    },
    cellLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text,
        maxWidth: '100%',
    },
    actionCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
    },
    minusBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.textDestructive,
    },
    card: {
        marginTop: 24,
    },
    input: {
        ...Typography.default(),
        minHeight: 48,
        paddingHorizontal: 14,
        borderRadius: 16,
        fontSize: 15,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHigh,
    },
    delete: {
        alignItems: 'center',
        paddingVertical: 16,
        marginTop: 32,
    },
    deleteText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.textDestructive,
    },
    disabled: {
        opacity: 0.4,
    },
    pressed: {
        opacity: 0.7,
    },
}));

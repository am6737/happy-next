import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Teammate } from 'happy-wire';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { sync } from '@/sync/sync';
import { useTeammates } from '@/sync/storage';
import { layout } from '@/components/layout';
import { MemberRow } from '@/components/teammates/MemberRow';
import { ChannelBriefField } from '@/components/teammates/ChannelBriefField';
import { Card, FieldError, InputRow, KIT_PAGE_PADDING, PillButton, SectionLabel } from '@/components/teammates/kit';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const MAX_MEMBERS = 20;


export default React.memo(function NewChannelScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const teammates = useTeammates().filter(m => m.status !== 'archived');
    const [title, setTitle] = React.useState('');
    const [brief, setBrief] = React.useState('');
    const [selected, setSelected] = React.useState<string[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        void sync.refreshTeammates().catch(() => setError(t('channels.error')));
    }, []);

    const create = async () => {
        if (busy || !selected.length || !title.trim()) return;
        setBusy(true);
        setError(null);
        try {
            const channel = await sync.channels.create('group', teammates.filter(m => selected.includes(m.id)), title.trim(), brief);
            router.replace(`/channels/${channel.id}`);
        } catch {
            setError(t('channels.createError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.page}>
            <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                <Card style={styles.titleCard}>
                    <InputRow label={t('channels.groupTitle')} value={title} onChange={value => setTitle(value.slice(0, 100))}
                        placeholder={t('channels.groupTitlePlaceholder')} />
                </Card>
                <SectionLabel title={t('tabs.teammates')} detail={`${selected.length}/${MAX_MEMBERS}`} />
                <Card>
                    {teammates.length ? teammates.map(member => {
                        const checked = selected.includes(member.id);
                        const disabled = busy || (!checked && selected.length >= MAX_MEMBERS);
                        return <MemberRow key={member.id} teammate={member} checked={checked} disabled={disabled}
                            onToggle={() => setSelected(ids => ids.includes(member.id) ? ids.filter(id => id !== member.id) : [...ids, member.id])} />;
                    }) : <Text style={styles.empty}>{t('teammates.emptyHint')}</Text>}
                </Card>
                {!!teammates.length && <Text style={styles.hint}>{t('channels.pickAgents')}</Text>}
                <ChannelBriefField value={brief} optional onSave={async text => { setBrief(text); return true; }} />
                <View style={styles.footer}>
                    <FieldError message={error} />
                    <PillButton grow label={t('channels.createGroup')} loading={busy}
                        disabled={busy || !title.trim() || !selected.length} onPress={create} />
                </View>
            </ScrollView>
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
    titleCard: {
        marginTop: 16,
    },
    member: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
    },
    memberText: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    role: {
        ...Typography.default(),
        marginTop: 2,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    indicator: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: theme.colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
    },
    indicatorSelected: {
        borderWidth: 0,
        backgroundColor: theme.colors.button.primary.background,
    },
    disabled: {
        opacity: 0.45,
    },
    pressed: {
        opacity: 0.7,
    },
    hint: {
        ...Typography.default(),
        marginTop: 8,
        paddingHorizontal: 4,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    empty: {
        ...Typography.default(),
        paddingVertical: 18,
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    footer: {
        gap: 12,
        marginTop: 28,
    },
}));

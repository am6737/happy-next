import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { sync } from '@/sync/sync';
import { useTeammates } from '@/sync/storage';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { RoundButton } from '@/components/RoundButton';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { TeammateAvatar } from '@/components/teammates/ui';
import { t } from '@/text';

const MAX_MEMBERS = 20;

export default React.memo(function NewChannelScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const teammates = useTeammates().filter(m => m.status !== 'archived');
    const [title, setTitle] = React.useState('');
    const [selected, setSelected] = React.useState<string[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    React.useEffect(() => { void sync.refreshTeammates().catch(() => setError(t('channels.error'))); }, []);
    const create = async () => {
        if (busy || !selected.length || !title.trim()) return;
        setBusy(true); setError(null);
        try {
            const channel = await sync.channels.create('group', teammates.filter(m => selected.includes(m.id)), title.trim());
            router.replace(`/channels/${channel.id}`);
        } catch { setError(t('channels.createError')); }
        finally { setBusy(false); }
    };
    return (
        <ItemList keyboardShouldPersistTaps="handled">
            <ItemGroup title={t('channels.groupTitle')}>
                <View style={styles.inputContainer}>
                    <TextInput
                        accessibilityLabel={t('channels.groupTitle')}
                        style={styles.input}
                        value={title}
                        onChangeText={setTitle}
                        maxLength={100}
                        editable={!busy}
                        placeholder={t('channels.groupTitle')}
                        placeholderTextColor={theme.colors.input.placeholder}
                    />
                </View>
            </ItemGroup>
            <ItemGroup title={t('tabs.teammates')} footer={t('channels.pickAgents')}>
                {teammates.map(member => {
                    const checked = selected.includes(member.id);
                    const disabled = busy || (!checked && selected.length >= MAX_MEMBERS);
                    return (
                        <Item
                            key={member.id}
                            title={member.name}
                            subtitle={`@${member.handle}`}
                            leftElement={<TeammateAvatar teammate={member} size={40} />}
                            selected={checked}
                            disabled={disabled}
                            onPress={() => setSelected(ids => ids.includes(member.id) ? ids.filter(id => id !== member.id) : [...ids, member.id])}
                        />
                    );
                })}
            </ItemGroup>
            <View style={styles.actions}>
                {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
                <RoundButton title={t('channels.createGroup')} disabled={busy || !title.trim() || !selected.length} loading={busy} onPress={create} />
            </View>
        </ItemList>
    );
});

const styles = StyleSheet.create((theme) => ({
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    input: {
        ...Typography.default(),
        fontSize: 16,
        minHeight: 24,
        color: theme.colors.input.text,
    },
    actions: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: 16,
        paddingTop: 8,
        gap: 12,
    },
    error: {
        fontSize: 14,
        color: theme.colors.textDestructive,
    },
}));

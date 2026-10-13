import React from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TeammateRow } from './TeammateRow';
import { sync } from '@/sync/sync';
import { useTeammates, useTeammatesLoaded } from '@/sync/storage';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { layout } from '@/components/layout';
import { useMainTabBottomPadding } from '@/hooks/useMainTabBottomPadding';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { teammateErrorMessage } from './ui';
import { PillButton } from './kit';

export function TeammatesList() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const teammates = useTeammates();
    const loaded = useTeammatesLoaded();
    const tabBottomPadding = useMainTabBottomPadding();
    const [includeArchived, setIncludeArchived] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const refresh = React.useCallback(async () => {
        setRefreshing(true);
        setError(null);
        try { await sync.refreshTeammates(); } catch (error) { setError(teammateErrorMessage(error)); }
        finally { setRefreshing(false); }
    }, []);
    useFocusEffect(React.useCallback(() => { void refresh(); }, [refresh]));
    const add = () => router.push('/teammates/new');

    const members = teammates.filter(teammate => teammate.status !== 'archived');
    const archivedCount = teammates.length - members.length;
    const visible = includeArchived ? teammates : members;

    return (
        <ItemList
            containerStyle={{ paddingBottom: tabBottomPadding + 16 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
            {error && (
                <View style={styles.errorCard}>
                    <Ionicons name="alert-circle-outline" size={18} color={theme.colors.textDestructive} />
                    <Text style={styles.error}>{error}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} hitSlop={8} onPress={refresh}>
                        <Text style={styles.retry}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            )}

            {!visible.length ? (!loaded && refreshing ? (
                <ActivityIndicator style={styles.loading} />
            ) : (
                <View style={styles.empty}>
                    <Text style={styles.emptyEmoji}>🤖</Text>
                    <Text style={styles.emptyTitle}>{t('teammates.emptyTitle')}</Text>
                    <Text style={styles.emptyHint}>{t('teammates.emptyHint')}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('teammates.add')}
                        onPress={add}
                        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                    >
                        <Ionicons name="add" size={18} color={theme.colors.button.primary.tint} />
                        <Text style={styles.addText}>{t('teammates.add')}</Text>
                    </Pressable>
                </View>
            )) : (
                <>
                    <View style={styles.newGroupWrap}>
                        <PillButton kind="secondary" icon="people-outline" label={t('channels.newGroup')} onPress={() => router.push('/channels/new')} />
                    </View>
                    <ItemGroup>
                        {visible.map(teammate => (
                            <TeammateRow key={teammate.id} teammate={teammate} />
                        ))}
                        {archivedCount > 0 && (
                            <Item
                                title={includeArchived ? t('teammates.hideArchived') : `${t('teammates.showArchived')}  ${archivedCount}`}
                                titleStyle={styles.toggle}
                                onPress={() => setIncludeArchived(value => !value)}
                            />
                        )}
                    </ItemGroup>
                </>
            )}
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    errorCard: {
        width: '100%',
        maxWidth: layout.maxWidth - 32,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
    },
    error: {
        ...Typography.default(),
        flex: 1,
        fontSize: 14,
        color: theme.colors.textDestructive,
    },
    retry: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    loading: {
        margin: 32,
    },
    empty: {
        alignItems: 'center',
        gap: 8,
        paddingTop: 48,
        paddingBottom: 24,
        paddingHorizontal: 32,
    },
    emptyEmoji: {
        fontSize: 44,
        marginBottom: 4,
    },
    emptyTitle: {
        ...Typography.default('semiBold'),
        fontSize: 19,
        color: theme.colors.text,
    },
    emptyHint: {
        ...Typography.default(),
        maxWidth: 360,
        marginBottom: 8,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: theme.colors.textSecondary,
    },
    add: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        paddingHorizontal: 18,
        borderRadius: 20,
        backgroundColor: theme.colors.button.primary.background,
    },
    addText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.button.primary.tint,
    },
    pressed: {
        opacity: 0.8,
    },
    toggle: {
        fontSize: 15,
        color: theme.colors.textLink,
    },
    newGroupWrap: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
        marginTop: 12,
        marginBottom: 4,
    },
}));

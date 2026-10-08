import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { getCurrentLanguage } from '@/text';
import { AiTeamRequestError, fetchAiWorkNotifications, fetchAiWorkspaces, fetchAiWorkspaceWorkItem,
    markAiWorkNotificationRead, type AiWorkNotification } from '@/sync/apiAiTeams';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 60, gap: 14 },
    row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 6 },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function AiNotificationsPage() {
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const router = useRouter();
    const isZh = getCurrentLanguage().startsWith('zh');
    const [items, setItems] = React.useState<AiWorkNotification[]>([]);
    const [cursor, setCursor] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const requestVersion = React.useRef(0);
    const activeSecret = React.useRef(credentials?.secret);
    activeSecret.current = credentials?.secret;
    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const secret = credentials.secret;
        const version = ++requestVersion.current;
        const result = await fetchAiWorkNotifications(credentials);
        if (version !== requestVersion.current || secret !== activeSecret.current) return;
        setItems(result.items); setCursor(result.nextCursor);
    }, [credentials?.secret]);
    React.useEffect(() => {
        setItems([]); setCursor(null); setError(null);
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
        return () => { requestVersion.current++; };
    }, [refresh]);
    const perform = async (action: () => Promise<void>) => {
        if (busy) return;
        setBusy(true); setError(null);
        try { await action(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const openWork = (item: AiWorkNotification) => perform(async () => {
        if (!credentials) return;
        const secret = credentials.secret;
        const spaces = await fetchAiWorkspaces(credentials);
        if (secret !== activeSecret.current) return;
        for (const space of spaces.items) {
            try {
                await fetchAiWorkspaceWorkItem(credentials, space.id, item.workItemId);
                if (secret !== activeSecret.current) return;
                router.push(`/settings/workspaces/work/${item.workItemId}?workspaceId=${space.id}` as never);
                return;
            } catch (cause) {
                if (!(cause instanceof AiTeamRequestError) || cause.status !== 404) throw cause;
            }
        }
        throw new Error(isZh ? '任务已不可访问，请刷新通知。' : 'Work item is no longer accessible. Refresh notifications.');
    });
    const actionLabel = (action: string) => action === 'comment_added'
        ? (isZh ? '新评论' : 'New comment')
        : action === 'metadata_updated' ? (isZh ? '任务资料已更新' : 'Work details updated') : action;
    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '任务通知' : 'Work notifications' }} />
        <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.actions}><Pressable style={styles.action} disabled={busy} onPress={() => perform(refresh)}>
                <Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '刷新' : 'Refresh'}</Text>
            </Pressable></View>
            {!items.length ? <Text style={styles.muted}>{isZh ? '暂无可见通知' : 'No visible notifications'}</Text> : null}
            {items.map((item) => <View key={item.id} style={styles.row}>
                <View style={styles.actions}>{!item.readAt ? <Ionicons name="ellipse" size={8} color={theme.colors.text} /> : null}
                    <Text style={styles.text}>{actionLabel(item.action)}</Text></View>
                <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()} · {item.actorAccountId}</Text>
                <Text style={styles.muted} selectable>{item.workItemId}</Text>
                <View style={styles.actions}>
                    <Pressable style={styles.action} disabled={busy} onPress={() => openWork(item)}>
                        <Ionicons name="open-outline" size={17} color={theme.colors.text} />
                        <Text style={styles.actionText}>{isZh ? '打开任务' : 'Open work item'}</Text>
                    </Pressable>
                    {!item.readAt ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) return;
                        const secret = credentials.secret;
                        await markAiWorkNotificationRead(credentials, item.id);
                        if (secret !== activeSecret.current) return;
                        await refresh();
                    })}><Ionicons name="checkmark-outline" size={17} color={theme.colors.text} />
                        <Text style={styles.actionText}>{isZh ? '标为已读' : 'Mark read'}</Text>
                    </Pressable> : null}
                </View>
            </View>)}
            {cursor ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                if (!credentials) return;
                const secret = credentials.secret;
                const version = requestVersion.current;
                const page = await fetchAiWorkNotifications(credentials, cursor);
                if (version !== requestVersion.current || secret !== activeSecret.current) return;
                setItems((current) => [...current, ...page.items]); setCursor(page.nextCursor);
            })}><Ionicons name="chevron-down-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '更多' : 'More'}</Text></Pressable> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

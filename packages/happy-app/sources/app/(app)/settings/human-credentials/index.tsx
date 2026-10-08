import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';
import { createHumanCredential, supportsHumanCredential } from '@/features/aiTeams/webAuthn';
import { beginAiHumanCredentialRegistration, fetchAiHumanCredentials,
    revokeAiHumanCredential, verifyAiHumanCredentialRegistration, type AiHumanCredential } from '@/sync/apiAiTeams';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 820, alignSelf: 'center', padding: 18, gap: 16 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, paddingVertical: 12, gap: 7 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6,
        paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function HumanCredentialsPage() {
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const [items, setItems] = React.useState<AiHumanCredential[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [supported, setSupported] = React.useState(false);
    const accountSecret = React.useRef(credentials?.secret);
    accountSecret.current = credentials?.secret;
    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const secret = credentials.secret;
        const result = await fetchAiHumanCredentials(credentials);
        if (secret === accountSecret.current) setItems(result.items);
    }, [credentials?.secret]);
    React.useEffect(() => {
        setItems([]); setError(null); setSupported(supportsHumanCredential());
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [refresh]);
    const register = async () => {
        if (!credentials || !supported || busy) return;
        const secret = credentials.secret;
        setBusy(true); setError(null);
        try {
            const challenge = await beginAiHumanCredentialRegistration(credentials);
            const response = await createHumanCredential(challenge.options);
            if (secret !== accountSecret.current) return;
            await verifyAiHumanCredentialRegistration(credentials, challenge.challengeId, response);
            await refresh();
        } catch (cause) { if (secret === accountSecret.current) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const revoke = async (item: AiHumanCredential) => {
        if (!credentials || busy || !await Modal.confirm(isZh ? '撤销此设备？' : 'Revoke this device?',
            isZh ? '撤销后不能用于执行恢复。' : 'It will no longer be usable for execution recovery.')) return;
        setBusy(true); setError(null);
        try { await revokeAiHumanCredential(credentials, item.id); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '身份核验设备' : 'Identity verification devices' }} />
        <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>{isZh ? '身份核验设备' : 'Identity verification devices'}</Text>
            <Text style={styles.text}>{isZh
                ? '新增设备需要独立核验归属。在核验完成前，设备不能确认执行恢复。'
                : 'A new device requires independent ownership review before it can confirm an execution recovery.'}</Text>
            {!supported ? <Text style={styles.error}>{isZh
                ? '当前浏览器或设备不支持安全身份核验；请使用支持的平台。'
                : 'Secure identity verification is unavailable on this browser or device.'}</Text> : null}
            <Pressable style={styles.action} disabled={busy || !supported} onPress={register}>
                <Ionicons name="add-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '添加设备' : 'Add device'}</Text>
            </Pressable>
            <Pressable style={styles.action} disabled={busy} onPress={() => refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>
                <Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '刷新状态' : 'Refresh status'}</Text>
            </Pressable>
            {items.map((item) => <View key={item.id} style={styles.row}>
                <Text style={styles.text}>{item.status === 'pending' ? (isZh ? '等待独立核验' : 'Awaiting independent review')
                    : item.status === 'trusted' ? (isZh ? '已核验' : 'Verified') : (isZh ? '已撤销' : 'Revoked')}</Text>
                <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()} · {item.deviceType}</Text>
                {item.status === 'pending' ? <Text style={styles.muted}>{isZh ? '此设备暂不能确认执行恢复。' : 'This device cannot confirm execution recovery yet.'}</Text> : null}
                {item.status !== 'revoked' ? <Pressable style={styles.action} disabled={busy} onPress={() => revoke(item)}>
                    <Ionicons name="close-outline" size={17} color={theme.colors.text} />
                    <Text style={styles.actionText}>{isZh ? '撤销' : 'Revoke'}</Text>
                </Pressable> : null}
            </View>)}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

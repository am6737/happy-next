import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';
import { AiTeamRequestError, confirmAiCapabilityRecovery, fetchAiCapabilityRecoveries,
    beginAiCapabilityRecoveryConfirmation, fetchAiCapabilityRecoveryAudit, fetchAiHumanCredentials, type AiCapabilityRecovery,
    type AiCapabilityRecoveryAudit } from '@/sync/apiAiTeams';
import { confirmHumanPresence, supportsHumanCredential } from '@/features/aiTeams/webAuthn';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 60, gap: 16 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 5 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function CapabilityRecoveriesPage() {
    const { credentials } = useAuth();
    const router = useRouter();
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const [items, setItems] = React.useState<AiCapabilityRecovery[]>([]);
    const [selected, setSelected] = React.useState<AiCapabilityRecovery | null>(null);
    const [audit, setAudit] = React.useState<AiCapabilityRecoveryAudit[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [stale, setStale] = React.useState(false);
    const [hasTrustedDevice, setHasTrustedDevice] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const requestVersion = React.useRef(0);
    const activeSecret = React.useRef(credentials?.secret);
    activeSecret.current = credentials?.secret;
    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const secret = credentials.secret;
        const version = ++requestVersion.current;
        const result = await fetchAiCapabilityRecoveries(credentials);
        if (version !== requestVersion.current || secret !== activeSecret.current) return;
        setItems(result.items);
        setSelected((current) => result.items.find((item) => item.id === current?.id) ?? null);
        setStale(false);
        const devices = await fetchAiHumanCredentials(credentials);
        if (version === requestVersion.current && secret === activeSecret.current)
            setHasTrustedDevice(devices.items.some((item) => item.status === 'trusted'));
    }, [credentials?.secret]);
    React.useEffect(() => {
        setItems([]); setSelected(null); setAudit([]); setStale(false); setHasTrustedDevice(false); setError(null);
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
        return () => { requestVersion.current++; };
    }, [refresh]);
    const open = async (item: AiCapabilityRecovery) => {
        if (!credentials) return;
        const secret = credentials.secret;
        const version = ++requestVersion.current;
        setSelected(item); setAudit([]); setError(null);
        try {
            const result = await fetchAiCapabilityRecoveryAudit(credentials, item.id);
            if (version === requestVersion.current && secret === activeSecret.current) setAudit(result.audit);
        } catch (cause) {
            if (version === requestVersion.current && secret === activeSecret.current) setError(cause instanceof Error ? cause.message : String(cause));
        }
    };
    const confirm = async () => {
        if (!credentials || !selected || busy || stale || selected.status !== 'pending' || !hasTrustedDevice || !supportsHumanCredential()) return;
        const secret = credentials.secret;
        const reviewed = selected;
        if (Date.parse(reviewed.requestExpiresAt) <= Date.now()) {
            setError(isZh ? '申请已过期，请刷新。' : 'Request expired. Refresh the list.'); return;
        }
        const accepted = await Modal.confirm(
            isZh ? '确认仅结束失败执行？' : 'Confirm failed execution drain?',
            `${isZh ? '执行' : 'Execution'} ${reviewed.executionId}\n${isZh ? '代际' : 'Generation'} ${reviewed.generation}\n${isZh ? '申请截止' : 'Request expires'} ${new Date(reviewed.requestExpiresAt).toLocaleString()}\n${isZh ? '仅允许回报失败；不会恢复模型或工具执行。' : 'Only a failed result is allowed; model and tools will not resume.'}`);
        if (!accepted) return;
        if (secret !== activeSecret.current) return;
        setBusy(true); setError(null);
        try {
            const challenge = await beginAiCapabilityRecoveryConfirmation(credentials, reviewed.id, reviewed.generation);
            if (challenge.recoveryId !== reviewed.id || challenge.generation !== reviewed.generation
                || challenge.action !== 'drain_failed_execution') throw new Error('Recovery request changed. Refresh and review again.');
            const assertion = await confirmHumanPresence(challenge.options);
            if (secret !== activeSecret.current) return;
            await confirmAiCapabilityRecovery(credentials, reviewed.id, reviewed.generation, challenge.challengeId, assertion);
            if (secret !== activeSecret.current) return;
            await refresh();
            const history = await fetchAiCapabilityRecoveryAudit(credentials, reviewed.id);
            if (secret !== activeSecret.current) return;
            setAudit(history.audit);
        } catch (cause) {
            if (secret !== activeSecret.current) return;
            if (cause instanceof AiTeamRequestError && cause.status === 409) {
                setStale(true);
                setError(isZh ? '代际或授权已变化。当前审核记录保留；请刷新并重新审查。' : 'Generation or access changed. Refresh and review again.');
            } else setError(cause instanceof Error ? cause.message : String(cause));
        } finally { setBusy(false); }
    };
    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '执行恢复确认' : 'Execution recovery' }} />
        <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.muted}>{isZh
                ? '确认恢复需要已独立核验的设备。未完成核验时不能继续。'
                : 'Recovery confirmation requires an independently verified device.'}</Text>
            <Pressable style={styles.action} onPress={() => router.push('/settings/human-credentials' as never)}>
                <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '管理核验设备' : 'Verification devices'}</Text>
            </Pressable>
            {!supportsHumanCredential() ? <Text style={styles.error}>{isZh
                ? '当前平台不支持安全身份核验，请使用支持的浏览器或设备。'
                : 'Secure identity verification is unavailable on this platform.'}</Text> : null}
            {!hasTrustedDevice ? <Text style={styles.error}>{isZh
                ? '尚无已核验设备，恢复确认不可用。'
                : 'No verified device is available for recovery confirmation.'}</Text> : null}
            <View style={styles.actions}><Pressable style={styles.action} disabled={busy} onPress={() => {
                refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
            }}><Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                <Text style={styles.actionText}>{isZh ? '刷新申请' : 'Refresh requests'}</Text></Pressable></View>
            {!items.length ? <Text style={styles.muted}>{isZh ? '暂无恢复申请' : 'No recovery requests'}</Text> : null}
            {items.map((item) => <Pressable key={item.id} style={styles.row} onPress={() => open(item)}>
                <Text style={styles.text}>{item.status} · generation {item.generation}</Text>
                <Text style={styles.muted} selectable>{item.executionId}</Text>
                <Text style={styles.muted}>{new Date(item.requestExpiresAt).toLocaleString()}</Text>
            </Pressable>)}
            {selected ? <View style={styles.row}>
                <Text style={styles.heading}>{isZh ? '当前审查' : 'Reviewing'} · generation {selected.generation}</Text>
                <Text style={styles.muted} selectable>{selected.id} · {selected.executionId}</Text>
                <Text style={styles.muted}>{selected.status} · {new Date(selected.requestExpiresAt).toLocaleString()}</Text>
                {audit.map((entry, index) => <Text key={`${entry.generation}:${entry.action}:${index}`} style={styles.muted}>
                    generation {entry.generation} · {entry.action} · {new Date(entry.createdAt).toLocaleString()} · {entry.actorAccountId}
                </Text>)}
                {selected.status === 'pending' ? <Pressable style={[styles.action, (busy || stale || !hasTrustedDevice || !supportsHumanCredential()) && { opacity: 0.45 }]} disabled={busy || stale || !hasTrustedDevice || !supportsHumanCredential()} onPress={confirm}>
                    <Ionicons name="checkmark-outline" size={17} color={theme.colors.text} />
                    <Text style={styles.actionText}>{isZh ? '确认回报失败' : 'Confirm failed drain'}</Text>
                </Pressable> : null}
            </View> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}

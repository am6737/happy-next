import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';
import { withAiMutationIdentity } from '@/sync/aiMutationJournal';
import { AiTeamRequestError, fetchAiWorkspaceWorkItem, fetchAiWorkAudit, fetchAiWorkComments,
    fetchAiWorkMetadata, patchAiWorkMetadata, postAiWorkComment, setAiWorkSubscription,
    type AiWorkspaceWorkItem, type AiWorkAudit, type AiWorkComment, type AiWorkMetadata } from '@/sync/apiAiTeams';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 64, gap: 24 },
    section: { gap: 10 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    input: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, color: theme.colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 4 },
}));

export default function AiWorkspaceWorkPage() {
    const { id, workspaceId } = useLocalSearchParams<{ id: string; workspaceId: string }>();
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const [work, setWork] = React.useState<AiWorkspaceWorkItem | null>(null);
    const [metadata, setMetadata] = React.useState<AiWorkMetadata | null>(null);
    const [priority, setPriority] = React.useState<AiWorkMetadata['priority']>('normal');
    const [labels, setLabels] = React.useState('');
    const [dueDate, setDueDate] = React.useState('');
    const [stale, setStale] = React.useState(false);
    const [latestRevision, setLatestRevision] = React.useState<number | null>(null);
    const [comments, setComments] = React.useState<AiWorkComment[]>([]);
    const [commentCursor, setCommentCursor] = React.useState<string | null>(null);
    const [commentDraft, setCommentDraft] = React.useState('');
    const [audit, setAudit] = React.useState<AiWorkAudit[]>([]);
    const [auditCursor, setAuditCursor] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const requestVersion = React.useRef(0);
    const canEdit = !!work;

    const applyMetadata = (value: AiWorkMetadata) => {
        setMetadata(value); setPriority(value.priority); setLabels(value.labels.join(', '));
        setDueDate(value.dueDate?.slice(0, 10) ?? ''); setStale(false); setLatestRevision(null);
    };
    const load = React.useCallback(async () => {
        if (!credentials || !id || !workspaceId) return;
        const version = ++requestVersion.current;
        const [detail, meta, commentPage, auditPage] = await Promise.all([
            fetchAiWorkspaceWorkItem(credentials, workspaceId, id), fetchAiWorkMetadata(credentials, id),
            fetchAiWorkComments(credentials, id), fetchAiWorkAudit(credentials, id),
        ]);
        if (version !== requestVersion.current) return;
        setWork(detail); applyMetadata(meta); setComments(commentPage.items); setCommentCursor(commentPage.nextCursor);
        setAudit(auditPage.items); setAuditCursor(auditPage.nextCursor);
    }, [credentials?.secret, id, workspaceId]);
    React.useEffect(() => {
        let active = true;
        const version = ++requestVersion.current;
        setWork(null); setMetadata(null); setComments([]); setAudit([]); setError(null);
        if (credentials && id && workspaceId) Promise.all([
            fetchAiWorkspaceWorkItem(credentials, workspaceId, id), fetchAiWorkMetadata(credentials, id),
            fetchAiWorkComments(credentials, id), fetchAiWorkAudit(credentials, id),
        ]).then(([detail, meta, commentPage, auditPage]) => {
            if (!active || version !== requestVersion.current) return;
            setWork(detail); applyMetadata(meta); setComments(commentPage.items); setCommentCursor(commentPage.nextCursor);
            setAudit(auditPage.items); setAuditCursor(auditPage.nextCursor);
        }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
        return () => { active = false; requestVersion.current++; };
    }, [credentials?.secret, id, workspaceId]);
    const perform = async (action: () => Promise<void>) => {
        if (busy) return;
        setBusy(true); setError(null);
        try { await action(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const saveMetadata = () => perform(async () => {
        if (!credentials || !metadata || !canEdit || stale) return;
        const version = requestVersion.current;
        const date = dueDate.trim();
        const parsedDate = date ? new Date(`${date}T00:00:00.000Z`) : null;
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parsedDate?.toISOString().slice(0, 10) !== date)) {
            throw new Error(isZh ? '日期格式应为 YYYY-MM-DD' : 'Use YYYY-MM-DD for the due date');
        }
        try {
            await patchAiWorkMetadata(credentials, id, { expectedRevision: metadata.metadataRevision,
                priority, labels: labels.split(',').map((item) => item.trim()).filter(Boolean),
                dueDate: parsedDate?.toISOString() ?? null });
            if (version !== requestVersion.current) return;
            const savedMetadata = await fetchAiWorkMetadata(credentials, id);
            if (version !== requestVersion.current) return;
            applyMetadata(savedMetadata);
            const savedWork = await fetchAiWorkspaceWorkItem(credentials, workspaceId, id);
            if (version !== requestVersion.current) return;
            setWork(savedWork);
        } catch (cause) {
            if (cause instanceof AiTeamRequestError && cause.status === 409) {
                const current = await fetchAiWorkMetadata(credentials, id);
                if (version !== requestVersion.current) return;
                setStale(true); setLatestRevision(current.metadataRevision);
                throw new Error(isZh ? '任务资料已更新；草稿保留，请对照最新版本后重新载入。' : 'Work details changed; your draft is kept until you review the current version.');
            }
            throw cause;
        }
    });

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '工作任务' : 'Work item' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {work ? <View style={styles.section}>
                <Text style={styles.heading}>{work.title}</Text>
                <Text style={styles.text}>{work.summary}</Text>
                <Text style={styles.muted}>{work.runStatus} · {work.taskStatus ?? '—'} · {work.latestExecutionStatus ?? '—'}</Text>
                <Text style={styles.muted} selectable>{work.id} · {work.orchestratorTaskId}</Text>
            </View> : null}
            {metadata ? <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '任务资料' : 'Work details'} · rev {metadata.metadataRevision}</Text>
                <View style={styles.actions}>{(['low', 'normal', 'high', 'urgent'] as const).map((value) => <Pressable key={value}
                    style={[styles.action, priority === value && styles.selected]} disabled={!canEdit || busy}
                    onPress={() => setPriority(value)}><Text style={styles.actionText}>{value}</Text></Pressable>)}</View>
                <TextInput style={styles.input} value={labels} editable={canEdit && !busy} onChangeText={setLabels}
                    placeholder={isZh ? '标签，以逗号分隔' : 'Labels, separated by commas'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={styles.input} value={dueDate} editable={canEdit && !busy} onChangeText={setDueDate}
                    placeholder={isZh ? '截止日期 YYYY-MM-DD' : 'Due date YYYY-MM-DD'} placeholderTextColor={theme.colors.textSecondary} />
                {stale ? <View style={styles.section}>
                    <Text style={styles.error}>{isZh ? '服务器版本' : 'Server revision'}: {latestRevision}</Text>
                    <Pressable style={styles.action} onPress={() => perform(async () => {
                        if (!credentials || !await Modal.confirm(isZh ? '载入最新任务资料？' : 'Load current details?',
                            isZh ? '未提交的编辑会被替换。' : 'Your unsaved edits will be replaced.')) return;
                        applyMetadata(await fetchAiWorkMetadata(credentials, id));
                    })}><Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                        <Text style={styles.actionText}>{isZh ? '载入最新版本' : 'Load current version'}</Text></Pressable>
                </View> : null}
                {canEdit ? <Pressable style={styles.action} disabled={busy || stale} onPress={saveMetadata}>
                    <Ionicons name="save-outline" size={17} color={theme.colors.text} />
                    <Text style={styles.actionText}>{isZh ? '保存任务资料' : 'Save details'}</Text></Pressable> : null}
                <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                    if (!credentials) return;
                    const result = await setAiWorkSubscription(credentials, id, !metadata.subscribed);
                    setMetadata({ ...metadata, subscribed: result.subscribed });
                })} accessibilityRole="checkbox" accessibilityState={{ checked: metadata.subscribed }} aria-checked={metadata.subscribed}>
                    <Ionicons name={metadata.subscribed ? 'checkbox-outline' : 'square-outline'} size={18} color={theme.colors.text} />
                    <Text style={styles.actionText}>{isZh ? '订阅此任务' : 'Subscribe to work item'}</Text>
                </Pressable>
                <Text style={styles.muted}>{isZh ? '评论和任务资料更新会出现在站内任务通知中。' : 'Comments and detail changes appear in work notifications.'}</Text>
            </View> : null}
            {work ? <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '评论' : 'Comments'} · {comments.length}</Text>
                {comments.map((item) => <View key={item.id} style={styles.row}>
                    <Text style={styles.text}>{item.body}</Text><Text style={styles.muted}>{item.actorAccountId} · {new Date(item.createdAt).toLocaleString()}</Text>
                </View>)}
                {commentCursor ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                    if (!credentials) return;
                    const page = await fetchAiWorkComments(credentials, id, commentCursor);
                    setComments((current) => [...current, ...page.items]); setCommentCursor(page.nextCursor);
                })}><Ionicons name="chevron-down-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '更多评论' : 'More comments'}</Text></Pressable> : null}
                {canEdit ? <>
                    <TextInput style={[styles.input, { minHeight: 86, textAlignVertical: 'top' }]} multiline value={commentDraft}
                        onChangeText={setCommentDraft} placeholder={isZh ? '写评论' : 'Write a comment'} placeholderTextColor={theme.colors.textSecondary} />
                    <Pressable style={styles.action} disabled={busy || !commentDraft.trim()} onPress={() => perform(async () => {
                        if (!credentials) return;
                        const body = commentDraft.trim();
                        await withAiMutationIdentity(credentials, `work-comment:${id}`, { workItemId: id, body },
                            (clientRequestId) => postAiWorkComment(credentials, id, { clientRequestId, body }));
                        setCommentDraft('');
                        const page = await fetchAiWorkComments(credentials, id);
                        setComments(page.items); setCommentCursor(page.nextCursor);
                    })}><Ionicons name="send-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '发送评论' : 'Post comment'}</Text></Pressable>
                </> : null}
            </View> : null}
            {work ? <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '审计记录' : 'Audit trail'} · {audit.length}</Text>
                {audit.map((item) => <View key={item.id} style={styles.row}>
                    <Text style={styles.text}>{item.action}</Text>
                    <Text style={styles.muted}>{item.actorAccountId} · {new Date(item.createdAt).toLocaleString()}</Text>
                </View>)}
                {auditCursor ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                    if (!credentials) return;
                    const page = await fetchAiWorkAudit(credentials, id, auditCursor);
                    setAudit((current) => [...current, ...page.items]); setAuditCursor(page.nextCursor);
                })}><Ionicons name="chevron-down-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '更多记录' : 'More records'}</Text></Pressable> : null}
            </View> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {work ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(load)}>
                <Ionicons name="refresh-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '刷新' : 'Refresh'}</Text>
            </Pressable> : null}
        </ScrollView>
    </View>;
}

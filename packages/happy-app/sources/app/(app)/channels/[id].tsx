import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import type { TeammateTask } from 'happy-wire';
import type { StoredChannelMessage } from '@/sync/channelReducers';
import { channelDecisionSelections, channelMentions, latestUnansweredTaskDecision } from '@/sync/channelDecisions';
import { AgentContentView } from '@/components/AgentContentView';
import { KeyboardCenteredEmpty } from '@/components/KeyboardCenteredEmpty';
import { floatingComposerAvailable } from '@/components/floatingComposer';
import { layout } from '@/components/layout';
import { ChannelMessageList } from '@/components/teammates/ChannelMessageList';
import { ChannelMessageRow, ChannelWorkingRow, type ChannelLink } from '@/components/teammates/ChannelMessageRow';
import { ChannelComposer } from '@/components/teammates/ChannelComposer';
import { teammateErrorMessage } from '@/components/teammates/ui';
import { useChannelChat } from '@/hooks/useChannelChat';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useAuth } from '@/auth/AuthContext';
import { retryTeammateRun } from '@/sync/apiTeammates';
import { openExternalUrl } from '@/utils/tauri';
import { Modal } from '@/modal';
import { t } from '@/text';

type SendRequest = { text: string; decisionSender?: string; retry?: StoredChannelMessage; taskId?: string | null; clear?: () => void };

const emptyMessages: StoredChannelMessage[] = [];

export default React.memo(function ChannelScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const openSession = useNavigateToSession();
    const { credentials } = useAuth();
    const channel = storage(state => state.channels[id]);
    const messages = storage(state => state.channelMessages[id] ?? emptyMessages);
    const teammates = storage(state => state.teammates);
    const runs = storage(state => state.teammateRuns);
    const teammateTasks = storage(state => state.teammateTasks);
    const taskDetails = storage(state => state.teammateTaskDetails);
    const loaded = useChannelChat(id, messages);
    // Written by AgentContentView as the floating composer lays out, read by the list on the UI thread.
    const composerHeight = useSharedValue(0);

    const members = React.useMemo(() => channel?.members.flatMap(m => m.teammateId && teammates[m.teammateId] ? [teammates[m.teammateId]] : []) ?? [], [channel?.members, teammates]);
    const tasks = React.useMemo(() => {
        const byId: Record<string, TeammateTask> = {};
        for (const member of members) for (const task of teammateTasks[member.id] ?? []) byId[task.id] = task;
        return byId;
    }, [members, teammateTasks]);
    const allTeammates = React.useMemo(() => Object.values(teammates), [teammates]);
    const taskOf = React.useCallback((taskId: string | null) => taskId ? tasks[taskId] ?? taskDetails[taskId]?.task : undefined, [tasks, taskDetails]);
    const working = members.filter(m => runs[m.id]?.some(run => run.status === 'running' && run.trigger === 'channel-message'));
    const choices = React.useMemo(() => channelDecisionSelections(messages), [messages]);
    const latestDecision = React.useMemo(() => channel?.kind === 'dm' ? latestUnansweredTaskDecision(messages) : null, [channel?.kind, messages]);
    const [dismissedDecision, setDismissedDecision] = React.useState<string | null>(null);
    const replyTaskId = latestDecision && latestDecision.id !== dismissedDecision ? latestDecision.taskId : null;
    useFocusEffect(React.useCallback(() => replyTaskId ? sync.tasks.watch('task', replyTaskId) : undefined, [replyTaskId]));

    const sendRequest = React.useRef<SendRequest | null>(null);
    const sendLock = React.useRef(false);
    const [sending, performSend] = useHappyAction(async () => {
        const request = sendRequest.current;
        if (!request || !channel) return;
        const { text, decisionSender, retry, taskId, clear } = request;
        let optimistic = false;
        try {
            if (!retry && text.trim() === '/new') { await sync.channels.reset(id); clear?.(); return; }
            const mentions = channel.kind === 'group' ? [...new Set([...channelMentions(text, members), ...(decisionSender ? [decisionSender] : [])])] : [];
            await sync.channels.send(id, { text }, retry?.mentions ?? mentions, retry?.localId ?? undefined,
                () => { optimistic = true; clear?.(); }, retry ? retry.taskId : taskId);
        } catch {
            // Once the message is listed, its row shows the failure and a retry link.
            if (!optimistic) Modal.alert(t('common.error'), t('channels.sendError'));
        } finally { sendLock.current = false; }
    });
    const send = (request: SendRequest) => {
        if (sendLock.current || !request.text.trim() || !channel) return;
        sendLock.current = true;
        sendRequest.current = request;
        performSend();
    };
    // Rows are memoized, so they get stable handlers that call the latest `send`.
    const sendRef = React.useRef(send);
    sendRef.current = send;
    const handleSend = React.useCallback((text: string, clear: () => void) => sendRef.current({ text, taskId: replyTaskId, clear }), [replyTaskId]);
    const handleReset = React.useCallback(() => sendRef.current({ text: '/new' }), []);
    const handleDecide = React.useCallback((message: StoredChannelMessage, label: string) => sendRef.current({
        text: label, decisionSender: message.senderType === 'teammate' ? message.senderId : undefined, taskId: message.taskId,
    }), []);
    const handleRetry = React.useCallback((message: StoredChannelMessage) => {
        if (message.body) sendRef.current({ text: message.body.text, retry: message });
    }, []);
    const retryRunId = React.useRef<string | null>(null);
    const [retryingRun, performRetryRun] = useHappyAction(async () => {
        const runId = retryRunId.current;
        if (!runId || !credentials) return;
        try { storage.getState().applyTeammateRun((await retryTeammateRun(credentials, runId)).run); }
        catch (error) { Modal.alert(t('common.error'), teammateErrorMessage(error)); }
    });
    const handleRetryRun = React.useCallback((runId: string) => { retryRunId.current = runId; performRetryRun(); }, [performRetryRun]);
    const handleOpenTask = React.useCallback((taskId: string) => router.push(`/teammates/tasks/${encodeURIComponent(taskId)}`), [router]);
    const handleOpenLink = React.useCallback((link: ChannelLink) => {
        if (link.kind === 'session' && link.sessionId) openSession(link.sessionId);
        else if (link.url) void openExternalUrl(link.url).catch(() => Modal.alert(t('common.error'), t('channels.linkError')));
    }, [openSession]);
    const handleDismissReply = React.useCallback(() => setDismissedDecision(latestDecision?.id ?? null), [latestDecision?.id]);

    const [historyExhausted, setHistoryExhausted] = React.useState(false);
    const [loadingEarlier, setLoadingEarlier] = React.useState(false);
    const loadingEarlierRef = React.useRef(false);
    const firstSeq = messages.find(m => !m.delivery)?.seq ?? 0;
    const handleLoadEarlier = React.useCallback(async () => {
        if (loadingEarlierRef.current) return;
        loadingEarlierRef.current = true;
        setLoadingEarlier(true);
        // A failed page is fetched again the next time the top is reached.
        try { setHistoryExhausted(!await sync.channels.loadEarlier(id)); } catch {}
        finally { loadingEarlierRef.current = false; setLoadingEarlier(false); }
    }, [id]);

    const renderMessage = React.useCallback((message: StoredChannelMessage, header: boolean) => (
        <ChannelMessageRow
            message={message}
            header={header}
            sender={message.senderType === 'teammate' ? teammates[message.senderId] : undefined}
            members={allTeammates}
            showReport={channel?.kind !== 'dm'}
            task={taskOf(message.taskId)}
            choice={choices[message.id]}
            busy={sending || retryingRun}
            onDecide={handleDecide}
            onRetry={handleRetry}
            onRetryRun={handleRetryRun}
            onOpenTask={handleOpenTask}
            onOpenLink={handleOpenLink}
        />
    ), [teammates, channel?.kind, allTeammates, taskOf, choices, sending, retryingRun, handleDecide, handleRetry, handleRetryRun, handleOpenTask, handleOpenLink]);
    const extraData = React.useMemo(() => ({ teammates, allTeammates, taskOf, choices, sending, retryingRun }), [teammates, allTeammates, taskOf, choices, sending, retryingRun]);

    const placeholder = (
        <View style={styles.center}>
            {loaded ? (
                <>
                    <Text style={styles.emptyText}>{t('channels.noMessages')}</Text>
                    <Text style={styles.emptyHint}>{t('channels.resetHint')}</Text>
                </>
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </View>
    );
    const content = (
        <ChannelMessageList
            messages={messages}
            renderMessage={renderMessage}
            extraData={extraData}
            hasMore={loaded && !historyExhausted && firstSeq > 1}
            loadingMore={loadingEarlier}
            onLoadMore={handleLoadEarlier}
            dataKey={id}
            emptyComponent={<KeyboardCenteredEmpty composerInset={floatingComposerAvailable ? composerHeight : undefined}>{placeholder}</KeyboardCenteredEmpty>}
            composerInset={floatingComposerAvailable ? composerHeight : undefined}
            footer={working.length > 0 ? <View>{working.map(member => <ChannelWorkingRow key={member.id} teammate={member} />)}</View> : null}
        />
    );
    const input = (
        <ChannelComposer
            kind={channel?.kind}
            members={members}
            replyTitle={replyTaskId ? taskOf(replyTaskId)?.title || t('teammateTasks.title') : null}
            onDismissReply={handleDismissReply}
            disabled={!channel || sending}
            onSend={handleSend}
            onReset={handleReset}
            glass={floatingComposerAvailable}
        />
    );

    return (
        <View style={styles.body}>
            <AgentContentView
                safeAreaLayout
                floatingInput={floatingComposerAvailable}
                composerHeight={composerHeight}
                content={content}
                input={input}
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: theme.colors.surface,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 32,
    },
    emptyText: {
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    emptyHint: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        textAlign: 'center',
    },
}));

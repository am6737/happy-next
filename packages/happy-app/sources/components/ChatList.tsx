import * as React from 'react';
import { useSession, useSessionMessages, useProfile, useSetting, storage } from "@/sync/storage";
import { ActivityIndicator, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { MessageView } from './MessageView';
import { ConversationMinimapItem } from './ConversationMinimap';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { AskUserQuestionMessage, isAskUserQuestionToolCall, isExitPlanModeToolCall, isPreviewHtmlToolCall, Message, MinimapMessage, PlanProposalMessage, PreviewHtmlMessage, toAskUserQuestionMessage, toPlanProposalMessage, toPreviewHtmlMessage, UserTextMessage } from '@/sync/typesMessage';
import { currentLandmark, railLandmarkRows, shouldHideMessageInChatList, shouldHideMessageInMinimap, type LandmarkRow } from './chatListVisibility';
import { turnHeaderProps, useTurnAnalysis } from './messageTurnTiming';
import { AWAITING_RESPONSE_MAX_MS } from '@/utils/sessionUtils';
import { layout } from './layout';
import { createScrollButtonVisibilityController } from './scrollButtonVisibilityController';
import { t } from '@/text';

// Does a loaded list message correspond to the given minimap target (whose id may come from the
// throwaway reducer and therefore not match the store's id)?
function messageMatchesTarget(message: Message, target: MinimapMessage): boolean {
    if (target.seq != null && message.seq === target.seq) return true;
    if (target.localId && (message as { localId?: string | null }).localId === target.localId) return true;
    return message.id === target.id;
}

// A loaded user message paired with its index in the inverted FlatList data (`visibleMessages`).
type LoadedUserMessage = { message: UserTextMessage; index: number };

// Describes a fork initiated from a message's inline fork icon.
export interface ForkMessageRequest {
    // The user message to truncate before — the new session keeps everything
    // older than it. For a fork from an AI reply this is the user prompt that
    // FOLLOWS the reply (so the reply itself is kept); `null` means there is no
    // following prompt, so the whole session is duplicated with no truncation.
    target: UserTextMessage | null;
    // The message whose fork icon was tapped — drives the inline loading spinner.
    loadingMessageId: string;
    // Suppress the new-session draft. User-message forks pre-fill the tapped
    // prompt; AI-message forks continue after the reply, so there's nothing to
    // pre-fill.
    skipDraft: boolean;
}

export const ChatList = React.memo((props: { session: Session; onFillInput?: (text: string, allOptions?: string[]) => void; onLoadMore?: () => void; onForkMessage?: (request: ForkMessageRequest) => void; forkingMessageId?: string | null; minimapCachedUserMessages?: MinimapMessage[]; onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void; onActiveMessageIdChange?: (id: string | null) => void; onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void }) => {
    const { messages, hasMore } = useSessionMessages(props.session.id);
    const profile = useProfile();
    const isSharedSession = !!(props.session.isShared || props.session.accessLevel);
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            hasMore={hasMore}
            onFillInput={props.onFillInput}
            onLoadMore={props.onLoadMore}
            isSharedSession={isSharedSession}
            currentUserId={profile.id}
            onForkMessage={props.onForkMessage}
            thinking={props.session.thinking}
            taskCompleted={props.session.agentState?.taskCompleted}
            awaitingResponseSince={props.session.awaitingResponseSince}
            forkingMessageId={props.forkingMessageId}
            minimapCachedUserMessages={props.minimapCachedUserMessages}
            onMinimapItemsChange={props.onMinimapItemsChange}
            onActiveMessageIdChange={props.onActiveMessageIdChange}
            onRegisterMinimapJump={props.onRegisterMinimapJump}
        />
    )
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />;
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

// Threshold in pixels for showing the scroll-to-bottom button
const SCROLL_THRESHOLD = 100;
const SHOW_SCROLL_BUTTON_DELAY_MS = 300;

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    hasMore: boolean,
    onFillInput?: (text: string, allOptions?: string[]) => void,
    onLoadMore?: () => void,
    isSharedSession: boolean,
    currentUserId: string,
    onForkMessage?: (request: ForkMessageRequest) => void,
    thinking?: boolean,
    /** `session.agentState.taskCompleted` — the CLI's stamp for the newest finished task. */
    taskCompleted?: number | null,
    /** `session.awaitingResponseSince` — set the moment a message is sent. */
    awaitingResponseSince?: number | null,
    forkingMessageId?: string | null,
    minimapCachedUserMessages?: MinimapMessage[],
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    /** The landmark the rail should mark as the reader's — see `currentLandmark`. */
    onActiveMessageIdChange?: (id: string | null) => void,
    onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const flatListRef = useRef<FlatList>(null);
    const showThinkingMessages = useSetting('showThinkingMessages');
    const visibleMessages = React.useMemo(
        () => props.messages.filter((message) => !shouldHideMessageInChatList(message, showThinkingMessages)),
        [props.messages, showThinkingMessages]
    );

    // Compute which user-text messages should show sender name labels.
    // In the inverted FlatList (index 0 = newest), show name when the next item
    // in the array (= older message at higher index) is from a different sender
    // or is not a user-text message, so only the first in a consecutive group shows it.
    const senderVisibility = React.useMemo(() => {
        if (!props.isSharedSession) return null;
        const map = new Map<string, boolean>();
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind !== 'user-text') continue;
            const nextMsg = visibleMessages[i + 1];
            const nextSentBy = nextMsg?.kind === 'user-text' ? nextMsg.sentBy : null;
            map.set(msg.id, msg.sentBy !== nextSentBy);
        }
        return map;
    }, [visibleMessages, props.isSharedSession]);

    // Which rows carry the action bar, which rows carry their turn's header, and
    // how long each turn took. See messageTurnTiming.ts for the rules.
    //
    // In flight means the CLI says it is thinking *or* the optimistic marker set
    // when a message is sent is still standing: the marker is written in the same
    // store update that lands the message, so a reply's header arrives with the
    // message instead of a CLI heartbeat later.
    const turnInFlight = !!props.thinking
        || (props.awaitingResponseSince != null
            && Date.now() - props.awaitingResponseSince < AWAITING_RESPONSE_MAX_MS);
    const turns = useTurnAnalysis({
        visibleMessages,
        turnInFlight,
        taskCompletedAt: props.taskCompleted,
    });

    // Track if scroll-to-bottom button should be visible
    const [showScrollButton, setShowScrollButton] = useState(false);
    const visibilityControllerRef = useRef<ReturnType<typeof createScrollButtonVisibilityController> | null>(null);
    const visibleMessagesRef = useRef(visibleMessages);

    // Track the newest message timestamp when button became visible (for unread count)
    const lastSeenTimestampRef = useRef<number>(visibleMessages[0]?.createdAt ?? 0);

    // Prevent duplicate load-more calls
    const isLoadingMoreRef = useRef(false);

    // Calculate unread count: count messages newer than the last seen timestamp
    let unreadCount = 0;
    if (showScrollButton) {
        for (const msg of visibleMessages) {
            if (msg.createdAt > lastSeenTimestampRef.current) {
                unreadCount++;
            } else {
                break; // messages are sorted newest-first, no need to continue
            }
        }
    }

    const keyExtractor = useCallback((item: any) => item.id, []);

    // Loaded user messages in ascending (oldest→newest) order, carrying their FlatList data index
    // (index into the inverted `visibleMessages`). Feeds the rail's landmarks below.
    const loadedUserMessages = React.useMemo<LoadedUserMessage[]>(() => {
        return visibleMessages
            .map((message, index) => message.kind === 'user-text'
                ? { message, index }
                : null)
            .filter((item): item is LoadedUserMessage => item !== null)
            .reverse();
    }, [visibleMessages]);

    // AskUserQuestion calls the rail places a marker for, in the same ascending order as
    // `loadedUserMessages`. Sub-agent (sidechain) questions live inside their parent's children and
    // are never top-level list rows, so they are not jump targets either.
    const loadedQuestionMessages = React.useMemo<MinimapMessage[]>(() => {
        return visibleMessages
            .filter(isAskUserQuestionToolCall)
            .map(toAskUserQuestionMessage)
            .filter((message): message is AskUserQuestionMessage => message !== null)
            .reverse();
    }, [visibleMessages]);

    // `preview_html` calls the rail places a marker for, in the same ascending order. Only calls
    // that produced a document qualify — see buildPreviewHtmlMessage.
    const loadedPreviewMessages = React.useMemo<MinimapMessage[]>(() => {
        return visibleMessages
            .filter(isPreviewHtmlToolCall)
            .map(toPreviewHtmlMessage)
            .filter((message): message is PreviewHtmlMessage => message !== null)
            .reverse();
    }, [visibleMessages]);

    // `ExitPlanMode` calls the rail places a marker for, in the same ascending order. Only calls
    // that carry a plan qualify — see buildPlanProposalMessage.
    const loadedPlanMessages = React.useMemo<MinimapMessage[]>(() => {
        return visibleMessages
            .filter(isExitPlanModeToolCall)
            .map(toPlanProposalMessage)
            .filter((message): message is PlanProposalMessage => message !== null)
            .reverse();
    }, [visibleMessages]);

    // Merge offline-cached landmarks with the loaded ones so the minimap can show prompts,
    // questions, previews and plan proposals that live in the persistent cache but haven't been
    // paged into the list yet. Loaded messages win on id (they carry an accurate scroll position);
    // rows the rail leaves out (see shouldHideMessageInMinimap) are dropped from both sources.
    const minimapItems = React.useMemo<ConversationMinimapItem[]>(() => {
        // Loaded messages always win (they carry the store's id → accurate scroll position + active
        // highlight). A cached entry is dropped if a loaded message matches it by EITHER seq OR
        // localId: the same message can be represented differently on each side (e.g. loaded is the
        // just-sent optimistic copy with a localId and no seq, cache has the acked copy with a seq),
        // so a single-key match would leak duplicates.
        const loadedBySeq = new Set<number>();
        const loadedByLocalId = new Set<string>();
        const merged: MinimapMessage[] = [];
        for (const loaded of [
            ...loadedUserMessages.map((item) => item.message),
            ...loadedQuestionMessages,
            ...loadedPreviewMessages,
            ...loadedPlanMessages,
        ]) {
            if (shouldHideMessageInMinimap(loaded)) continue;
            merged.push(loaded);
            if (loaded.seq != null) loadedBySeq.add(loaded.seq);
            if (loaded.localId) loadedByLocalId.add(loaded.localId);
        }
        for (const cached of props.minimapCachedUserMessages ?? []) {
            if (shouldHideMessageInMinimap(cached)) continue;
            if (cached.seq != null && loadedBySeq.has(cached.seq)) continue;
            if (cached.localId && loadedByLocalId.has(cached.localId)) continue;
            merged.push(cached);
        }
        // Order oldest→newest to match the list (which sorts by createdAt, seq as tiebreaker).
        // createdAt must be primary: just-sent messages have no seq yet, so keying on seq would
        // sort them as seq 0 and shove them to the very top instead of the bottom.
        return merged
            .sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0))
            .map((message) => ({ message }));
    }, [props.minimapCachedUserMessages, loadedUserMessages, loadedQuestionMessages, loadedPreviewMessages, loadedPlanMessages]);

    // Landmark rows in the list's own order — newest first — carrying the index each has there. Only a
    // row the rail draws a mark for counts, so the landmark the rail is told to light is always one it
    // has; the rail's current landmark is read off these and the rows on screen, see `currentLandmark`.
    const landmarkRows = React.useMemo(
        () => railLandmarkRows(visibleMessages, new Set(minimapItems.map((item) => item.message.id))),
        [visibleMessages, minimapItems],
    );
    const landmarkRowsRef = useRef(landmarkRows);
    const activeMessageIdRef = useRef<string | null>(null);

    const scrollToLoadedMessage = useCallback((target: MinimapMessage, animated = true): boolean => {
        const index = visibleMessagesRef.current.findIndex((m) => messageMatchesTarget(m, target));
        if (index >= 0) {
            flatListRef.current?.scrollToIndex({ index, animated, viewPosition: 0.5 });
            return true;
        }
        return false;
    }, []);

    // Scroll to a just-paged-in target, retrying until the row is actually rendered. visibleMessagesRef
    // only updates after React commits the re-render triggered by the store change, which a single tick
    // doesn't guarantee — on a slow frame a one-shot scroll misses and the jump silently fails. Retry on
    // a bounded schedule instead.
    const scrollToTargetWithRetries = useCallback((target: MinimapMessage, animated: boolean) => {
        let attempts = 0;
        const MAX_ATTEMPTS = 20; // ~1s at 50ms
        const attempt = () => {
            if (scrollToLoadedMessage(target, animated)) return;
            if (++attempts >= MAX_ATTEMPTS) return;
            setTimeout(attempt, 50);
        };
        attempt();
    }, [scrollToLoadedMessage]);

    // Guards against a jump-triggered load-more racing with the scroll-driven one.
    const isJumpingRef = useRef(false);
    // The target of the in-flight jump. A second minimap click updates this so the running paging
    // loop retargets instead of the click being silently dropped.
    const activeJumpTargetRef = useRef<MinimapMessage | null>(null);
    // Shows a bottom-centered hint while a minimap jump pages in older history before locating.
    const [isLocating, setIsLocating] = useState(false);
    const handleJumpToMessage = useCallback(async (target: MinimapMessage) => {
        activeJumpTargetRef.current = target;
        // A paging jump is already running — it will pick up the new target above. Keep the hint.
        if (isJumpingRef.current) return;
        // Already loaded → scroll straight away.
        if (scrollToLoadedMessage(target)) return;
        isJumpingRef.current = true;
        setIsLocating(true);
        try {
            // Page older messages until the (possibly retargeted) message enters the list, there's
            // nothing older left, or a load can't make progress.
            const MAX_PAGES = 200;
            for (let i = 0; i < MAX_PAGES; i++) {
                const current = activeJumpTargetRef.current;
                if (!current) break;
                const state = storage.getState().sessionMessages[props.sessionId];
                if (!state || !state.hasMore) break;
                if (state.messages.some((m) => messageMatchesTarget(m, current))) break;
                const beforeOldestSeq = state.oldestSeq;
                await props.onLoadMore?.();
                // Let the store subscription flush into visibleMessagesRef before re-checking.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                const loaded = storage.getState().sessionMessages[props.sessionId];
                if (!loaded) break;
                const retargeted = activeJumpTargetRef.current ?? current;
                if (loaded.messages.some((m) => messageMatchesTarget(m, retargeted))) break;
                // Safety: if we've paged at/past the target's seq without finding it, stop.
                if (retargeted.seq != null && loaded.oldestSeq != null && loaded.oldestSeq <= retargeted.seq) break;
                // No progress (e.g. encryption briefly unavailable, or oldestSeq null) — stop instead
                // of spinning through all MAX_PAGES iterations.
                if (loaded.oldestSeq === beforeOldestSeq) break;
            }
        } finally {
            isJumpingRef.current = false;
            setIsLocating(false);
        }
        // Far target (just paged in): jump instantly (with retries). An animated scroll over a long
        // distance would render/measure every intervening row frame-by-frame (janky); a direct jump
        // only lays out around the target.
        const finalTarget = activeJumpTargetRef.current;
        if (finalTarget) {
            scrollToTargetWithRetries(finalTarget, false);
        }
    }, [scrollToLoadedMessage, scrollToTargetWithRetries, props.onLoadMore, props.sessionId]);

    const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
        flatListRef.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: false,
        });
        setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 });
        }, 120);
    }, []);

    React.useEffect(() => {
        props.onRegisterMinimapJump?.(handleJumpToMessage);
        return () => props.onRegisterMinimapJump?.(null);
    }, [props.onRegisterMinimapJump, handleJumpToMessage]);

    React.useEffect(() => {
        props.onMinimapItemsChange?.(minimapItems);

        // A landmark the rail no longer carries cannot be marked — the reader was on it and it has left
        // the rail (a summary dropped by the list filter, a page reloaded away) — so rest on the newest.
        const activeId = activeMessageIdRef.current;
        if (activeId !== null && minimapItems.some((item) => item.message.id === activeId)) return;

        const newest = minimapItems[minimapItems.length - 1];
        activeMessageIdRef.current = newest ? newest.message.id : null;
        props.onActiveMessageIdChange?.(activeMessageIdRef.current);
    }, [props.onMinimapItemsChange, props.onActiveMessageIdChange, minimapItems]);

    const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item?: Message; index?: number | null }> }) => {
        const visibleIndexes: number[] = [];
        for (const viewable of viewableItems) {
            if (typeof viewable.index === 'number') {
                visibleIndexes.push(viewable.index);
            }
        }

        // Which landmark the reader is on is a question about the whole list — where they sit among its
        // landmarks — not about the rows that happen to be on screen; see `currentLandmark`. The marker
        // follows them back through prompts, questions and previews alike, so no landmark on the rail is
        // unreachable.
        const next = currentLandmark(landmarkRowsRef.current, visibleIndexes);
        // No row measured at all, which RN reports now and then as the list settles: keep the last
        // answer rather than flicking the rail to an endpoint.
        if (next === null || next === activeMessageIdRef.current) return;
        activeMessageIdRef.current = next;
        props.onActiveMessageIdChange?.(next);
    }).current;

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 10,
        minimumViewTime: 80,
    }).current;

    const renderItem = useCallback(({ item, index }: { item: Message, index: number }) => {
        // Agent turns show the action bar only on their last text segment, and
        // only once the turn settled — a reply still being generated is not a
        // finished message. User messages always show it.
        const isTurnEnd = item.kind === 'agent-text' && turns.completedIds.has(item.id);
        const showActionBar = item.kind === 'agent-text' ? isTurnEnd : true;
        const turnHeader = turnHeaderProps(turns.headerById.get(item.id));
        // Fork is offered on user prompts and on AI replies (private sessions only):
        // - User message: fork truncates before this prompt; its text becomes the
        //   new session's draft.
        // - AI reply: fork keeps the conversation through this reply by truncating
        //   before the NEXT user prompt (newer → lower index in the inverted
        //   array), with no draft. If there is no later prompt, the whole session
        //   is duplicated. Only the turn's last segment carries the action bar.
        let onFork: (() => void) | undefined;
        if (props.onForkMessage && !props.isSharedSession) {
            if (item.kind === 'user-text') {
                const target = item;
                onFork = () => props.onForkMessage!({ target, loadingMessageId: item.id, skipDraft: false });
            } else if (item.kind === 'agent-text' && isTurnEnd) {
                let nextUserMessage: UserTextMessage | null = null;
                for (let j = index - 1; j >= 0; j--) {
                    const newer = visibleMessages[j];
                    if (newer.kind === 'user-text') { nextUserMessage = newer; break; }
                }
                onFork = () => props.onForkMessage!({ target: nextUserMessage, loadingMessageId: item.id, skipDraft: true });
            }
        }
        const forkLoading = !!props.forkingMessageId && props.forkingMessageId === item.id;
        return (
            <MessageView
                message={item}
                metadata={props.metadata}
                sessionId={props.sessionId}
                isNewestMessage={index === 0}
                onFillInput={props.onFillInput}
                onFork={onFork}
                showActionBar={showActionBar}
                forkLoading={forkLoading}
                isSharedSession={props.isSharedSession}
                currentUserId={props.currentUserId}
                showSenderName={senderVisibility?.get(item.id) ?? false}
                {...turnHeader}
            />
        );
    }, [props.metadata, props.sessionId, props.onFillInput, props.onForkMessage, props.isSharedSession, props.currentUserId, senderVisibility, turns, props.forkingMessageId, visibleMessages]);

    React.useEffect(() => {
        visibleMessagesRef.current = visibleMessages;
    }, [visibleMessages]);

    React.useEffect(() => {
        landmarkRowsRef.current = landmarkRows;
    }, [landmarkRows]);

    React.useEffect(() => {
        const controller = createScrollButtonVisibilityController({
            showDelayMs: SHOW_SCROLL_BUTTON_DELAY_MS,
            onShow: () => {
                setShowScrollButton((prev) => {
                    if (prev) return prev;
                    lastSeenTimestampRef.current = visibleMessagesRef.current[0]?.createdAt ?? 0;
                    return true;
                });
            },
            onHide: () => {
                setShowScrollButton(false);
            },
        });

        visibilityControllerRef.current = controller;
        return () => {
            controller.dispose();
            visibilityControllerRef.current = null;
        };
    }, []);

    // Handle scroll position changes
    const handleScroll = useCallback((event: any) => {
        const offsetY = event.nativeEvent.contentOffset.y;
        const shouldShow = offsetY > SCROLL_THRESHOLD;
        visibilityControllerRef.current?.update(shouldShow);
    }, []);

    // Scroll to bottom when button is pressed
    const handleScrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, []);

    // Handle load more when scrolling to top (oldest messages)
    const handleEndReached = useCallback(() => {
        if (!props.hasMore || !props.onLoadMore || isLoadingMoreRef.current) {
            return;
        }
        isLoadingMoreRef.current = true;
        Promise.resolve(props.onLoadMore()).finally(() => {
            isLoadingMoreRef.current = false;
        });
    }, [props.hasMore, props.onLoadMore]);

    // Loading indicator shown at the top (oldest end) of the list
    const listFooter = React.useMemo(() => (
        <View>
            <ListHeader />
            {props.hasMore && (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            )}
        </View>
    ), [props.hasMore, theme.colors.textSecondary]);

    return (
        <View style={{ flex: 1 }}>
            <FlatList
                ref={flatListRef}
                data={visibleMessages}
                inverted={true}
                keyExtractor={keyExtractor}
                maintainVisibleContentPosition={{
                    minIndexForVisible: 0,
                    autoscrollToTopThreshold: 100,
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                renderItem={renderItem}
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={listFooter}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.5}
                onViewableItemsChanged={handleViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                onScrollToIndexFailed={handleScrollToIndexFailed}
            />

            {/* Bottom-centered hint shown while a minimap jump is paging in older messages */}
            {isLocating && (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.surfaceHighest,
                            borderRadius: 20,
                            paddingHorizontal: 14,
                            height: 36,
                            shadowColor: theme.colors.shadow.color,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: theme.colors.shadow.opacity,
                            shadowRadius: 4,
                            elevation: 4,
                        }}
                    >
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={{ marginLeft: 8, color: theme.colors.text, fontSize: 14 }}>
                            {t('session.locatingMessage')}
                        </Text>
                    </View>
                </View>
            )}

            {/* Scroll to bottom button - positioned relative to content area */}
            {showScrollButton && (
                <View
                    pointerEvents="box-none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        pointerEvents="box-none"
                        style={{
                            width: '100%',
                            maxWidth: layout.maxWidth,
                            alignItems: 'flex-end',
                            paddingRight: 16,
                        }}
                    >
                        <Pressable
                            onPress={handleScrollToBottom}
                            style={{
                                backgroundColor: theme.colors.surfaceHighest,
                                borderRadius: 20,
                                width: 40,
                                height: 40,
                                alignItems: 'center',
                                justifyContent: 'center',
                                shadowColor: theme.colors.shadow.color,
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: theme.colors.shadow.opacity,
                                shadowRadius: 4,
                                elevation: 4,
                            }}
                        >
                            <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
                            {unreadCount > 0 && (
                                <View style={{
                                    position: 'absolute',
                                    top: -4,
                                    right: -4,
                                    backgroundColor: theme.colors.status.connected,
                                    borderRadius: 10,
                                    minWidth: 20,
                                    height: 20,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingHorizontal: 4,
                                }}>
                                    <Text style={{
                                        color: '#fff',
                                        fontSize: 12,
                                        fontWeight: '600',
                                    }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
});

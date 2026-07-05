import * as React from 'react';
import { useSession, useSessionMessages, useProfile } from "@/sync/storage";
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
import { Message, UserTextMessage } from '@/sync/typesMessage';
import { layout } from './layout';
import { createScrollButtonVisibilityController } from './scrollButtonVisibilityController';

const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/;

function isCompactionMarkerText(text: string): boolean {
    return LOCAL_COMMAND_STDOUT_PATTERN.test(text.trim());
}

function shouldHideMessageInChatList(message: Message): boolean {
    return message.kind === 'user-text' && isCompactionMarkerText(message.displayText ?? message.text);
}

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

export const ChatList = React.memo((props: { session: Session; onFillInput?: (text: string, allOptions?: string[]) => void; onLoadMore?: () => void; onForkMessage?: (request: ForkMessageRequest) => void; forkingMessageId?: string | null; onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void; onActiveMessageIdsChange?: (ids: Set<string>) => void; onRegisterMinimapJump?: (jump: ((index: number) => void) | null) => void }) => {
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
            forkingMessageId={props.forkingMessageId}
            onMinimapItemsChange={props.onMinimapItemsChange}
            onActiveMessageIdsChange={props.onActiveMessageIdsChange}
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
    forkingMessageId?: string | null,
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    onActiveMessageIdsChange?: (ids: Set<string>) => void,
    onRegisterMinimapJump?: (jump: ((index: number) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const flatListRef = useRef<FlatList>(null);
    const visibleMessages = React.useMemo(
        () => props.messages.filter((message) => !shouldHideMessageInChatList(message)),
        [props.messages]
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

    // Compute which agent-text messages are the LAST text segment of their turn.
    // An assistant turn can span several agent-text blocks (interleaved with
    // tool calls / thinking); the action bar (copy + time) should appear only
    // once per turn, on its final text block. In the inverted array (index 0 =
    // newest), scanning toward newer (lower index): the first non-thinking
    // agent-text means a newer text block exists (not last); a user-text means
    // we've reached the turn boundary (this turn is complete → this is its last
    // segment); tool-call / agent-event / thinking blocks are skipped.
    //
    // The newest turn (scan reaches the start without hitting a user message)
    // is only marked complete when the agent is idle (`!thinking`); while the
    // agent is still generating, the bar is suppressed for the whole turn so it
    // doesn't attach to a segment that isn't truly final yet.
    // Latch of segment ids already shown as their turn's final segment. Keeps the
    // bar shown if `thinking` briefly flips true again (it can turn true a frame
    // before a freshly-sent user message lands in the list), avoiding a flicker.
    const completedTurnIdsRef = useRef<Set<string>>(new Set());
    const lastAgentSegmentIds = React.useMemo(() => {
        const set = new Set<string>();
        const previouslyCompleted = completedTurnIdsRef.current;
        const stillCompleted = new Set<string>();
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind !== 'agent-text' || msg.isThinking) continue;
            let isLast = true;
            let reachedUserBoundary = false;
            for (let j = i - 1; j >= 0; j--) {
                const newer = visibleMessages[j];
                if (newer.kind === 'agent-text' && !newer.isThinking) { isLast = false; break; }
                if (newer.kind === 'user-text') { reachedUserBoundary = true; break; }
            }
            if (!isLast) continue;
            // Older (already-bounded) turns are always complete; the newest turn
            // only counts as complete once the agent stops thinking — unless it
            // was already shown as complete (latched).
            if (reachedUserBoundary || !props.thinking || previouslyCompleted.has(msg.id)) {
                set.add(msg.id);
                stillCompleted.add(msg.id);
            }
        }
        completedTurnIdsRef.current = stillCompleted;
        return set;
    }, [visibleMessages, props.thinking]);

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
    const minimapUserMessages = React.useMemo(() => {
        return visibleMessages
            .map((message, index) => message.kind === 'user-text'
                ? { message, index }
                : null)
            .filter((item): item is ConversationMinimapItem => item !== null)
            .reverse();
    }, [visibleMessages]);
    const minimapUserMessagesRef = useRef(minimapUserMessages);
    const activeMessageIdsRef = useRef<Set<string>>(new Set());

    const handleJumpToMessage = useCallback((index: number) => {
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }, []);

    const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
        flatListRef.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: true,
        });
        setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
        }, 120);
    }, []);

    React.useEffect(() => {
        props.onRegisterMinimapJump?.(handleJumpToMessage);
        return () => props.onRegisterMinimapJump?.(null);
    }, [props.onRegisterMinimapJump, handleJumpToMessage]);

    React.useEffect(() => {
        props.onMinimapItemsChange?.(minimapUserMessages);

        const validIds = new Set(minimapUserMessages.map((item) => item.message.id));
        const stillValidActiveIds = Array.from(activeMessageIdsRef.current).filter((id) => validIds.has(id));
        if (stillValidActiveIds.length > 0) {
            const next = new Set(stillValidActiveIds);
            activeMessageIdsRef.current = next;
            props.onActiveMessageIdsChange?.(next);
            return;
        }

        const fallback = minimapUserMessages[minimapUserMessages.length - 1];
        const next = fallback ? new Set([fallback.message.id]) : new Set<string>();
        activeMessageIdsRef.current = next;
        props.onActiveMessageIdsChange?.(next);
    }, [props.onMinimapItemsChange, props.onActiveMessageIdsChange, minimapUserMessages]);

    const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item?: Message; index?: number | null }> }) => {
        const next = new Set<string>();
        const visibleIndexes: number[] = [];
        for (const viewable of viewableItems) {
            if (typeof viewable.index === 'number') {
                visibleIndexes.push(viewable.index);
            }
            const item = viewable.item;
            if (item?.kind === 'user-text') {
                next.add(item.id);
            }
        }

        // If the viewport is between two user prompts (e.g. only assistant/tool output is
        // visible), keep the rail useful by highlighting the nearest loaded user prompt.
        // During very fast scrolling, RN can briefly report no viewable indexes at all; in
        // that case keep the previous active marker instead of jumping to an endpoint.
        if (next.size === 0) {
            const userItems = minimapUserMessagesRef.current;
            if (userItems.length > 0 && visibleIndexes.length > 0) {
                const centerIndex = visibleIndexes.reduce((sum, index) => sum + index, 0) / visibleIndexes.length;
                let nearest = userItems[0];
                let nearestDistance = Math.abs(nearest.index - centerIndex);
                for (const userItem of userItems) {
                    const distance = Math.abs(userItem.index - centerIndex);
                    if (distance < nearestDistance) {
                        nearest = userItem;
                        nearestDistance = distance;
                    }
                }
                next.add(nearest.message.id);
            } else {
                const validIds = new Set(userItems.map((item) => item.message.id));
                for (const id of activeMessageIdsRef.current) {
                    if (validIds.has(id)) {
                        next.add(id);
                    }
                }
            }
        }

        if (next.size > 0 || minimapUserMessagesRef.current.length === 0) {
            activeMessageIdsRef.current = next;
            props.onActiveMessageIdsChange?.(next);
        }
    }).current;

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 10,
        minimumViewTime: 80,
    }).current;

    const renderItem = useCallback(({ item, index }: { item: Message, index: number }) => {
        // Agent turns show the action bar only on their last text segment;
        // user messages always show it.
        const showActionBar = item.kind === 'agent-text'
            ? lastAgentSegmentIds.has(item.id)
            : true;
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
            } else if (item.kind === 'agent-text' && showActionBar) {
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
            />
        );
    }, [props.metadata, props.sessionId, props.onFillInput, props.onForkMessage, props.isSharedSession, props.currentUserId, senderVisibility, lastAgentSegmentIds, props.forkingMessageId, visibleMessages]);

    React.useEffect(() => {
        visibleMessagesRef.current = visibleMessages;
    }, [visibleMessages]);

    React.useEffect(() => {
        minimapUserMessagesRef.current = minimapUserMessages;
    }, [minimapUserMessages]);

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

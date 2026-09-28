import * as React from 'react';
import { View, Text, ActivityIndicator, Pressable, Platform, type ScrollViewProps } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { ChatBubble } from './ChatBubble';
import type { DooTaskDialogMsg, DisplayMessage, PendingMessage } from '@/sync/dootask/types';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';
import Animated, { type SharedValue } from 'react-native-reanimated';
import { ChatScrollView } from '@/components/ChatScrollView';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from '@/components/floatingComposer';
import { useChatOverlayStyle } from '@/hooks/useChatOverlayStyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Threshold in pixels for showing the scroll-to-bottom button
const SCROLL_THRESHOLD = 100;

const AI_ASSISTANT_USERID = -1;

function isPending(msg: DisplayMessage): msg is PendingMessage {
    return '_pendingId' in msg;
}

/** Convert a PendingMessage into a DooTaskDialogMsg shape so ChatBubble renderers work unchanged. */
function buildFakeDooTaskMsg(pending: PendingMessage): DooTaskDialogMsg {
    let msg: any;
    if (pending.type === 'text') {
        msg = { text: pending.msg, type: 'md' };
    } else if (pending.type === 'image') {
        msg = { url: pending.msg }; // base64 data URI works as Image source
    } else {
        msg = { name: pending.msg.name, size: 0 };
    }
    return {
        id: 0,
        dialog_id: pending.dialog_id,
        userid: pending.userid,
        type: pending.type,
        msg,
        reply_id: pending.reply_id,
        reply_num: 0,
        created_at: pending.created_at,
        emoji: [],
        bot: 0,
        modify: 0,
        forward_id: null,
        forward_num: 0,
    };
}

type ChatMessageListProps = {
    messages: DisplayMessage[];
    currentUserId: number;
    userNames: Record<number, string>;
    userAvatars: Record<number, string | null>;
    userDisabledAt: Record<number, string | null>;
    onLoadMore: () => void;
    loadingMore: boolean;
    hasMore: boolean;
    onMessageLongPress: (msg: DooTaskDialogMsg, layout?: { y: number; height: number }) => void;
    onImagePress: (url: string) => void;
    onEmojiPress?: (msgId: number, symbol: string) => void;
    onRetry?: (pendingId: string) => void;
    serverUrl: string;
    dataKey?: string;
    emptyComponent?: React.ReactElement | null;
    /** The height of a composer floating over the list (see `AgentContentView`'s `floatingInput`). */
    composerInset?: SharedValue<number>;
};

/** Resolve a potentially relative avatar URL to an absolute one, handling {{RemoteURL}} placeholder. */
function resolveAvatarUrl(avatarPath: string | null | undefined, serverUrl: string): string | null {
    if (!avatarPath) return null;
    const base = serverUrl.replace(/\/+$/, '') + '/';
    const resolved = avatarPath.replace(/\{\{RemoteURL\}\}/g, base);
    if (resolved.startsWith('http') || resolved.startsWith('//')) return resolved;
    return base + resolved.replace(/^\/+/, '');
}

/**
 * Messages arrive newest-first, but LegendList renders chronologically without inversion.
 */
export const ChatMessageList = React.memo(({
    messages,
    currentUserId,
    userNames,
    userAvatars,
    userDisabledAt,
    onLoadMore,
    loadingMore,
    hasMore,
    onMessageLongPress,
    onImagePress,
    onEmojiPress,
    onRetry,
    serverUrl,
    dataKey,
    emptyComponent,
    composerInset,
}: ChatMessageListProps) => {
    const { theme } = useUnistyles();
    const listRef = React.useRef<LegendListRef>(null);
    const softHeaderInset = useSoftHeaderInset();
    const insets = useSafeAreaInsets();
    const chronologicalMessages = React.useMemo(() => [...messages].reverse(), [messages]);

    // Scroll-to-bottom button visibility
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    // Track the newest message created_at when button became visible (for unread count)
    const lastSeenCreatedAtRef = React.useRef<string>(messages[0]?.created_at ?? '');

    // Calculate unread count: only messages newer than when button appeared
    let unreadCount = 0;
    if (showScrollButton) {
        for (const msg of messages) {
            if (msg.created_at > lastSeenCreatedAtRef.current) {
                unreadCount++;
            } else {
                break; // messages sorted newest-first
            }
        }
    }

    const handleScroll = React.useCallback((event: any) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
        const shouldShow = distanceFromEnd > SCROLL_THRESHOLD;
        setShowScrollButton(prev => {
            if (shouldShow && !prev) {
                lastSeenCreatedAtRef.current = messages[0]?.created_at ?? '';
            }
            return shouldShow;
        });
    }, [messages]);

    const handleScrollToBottom = React.useCallback(() => {
        void listRef.current?.scrollToEnd({ animated: false });
    }, []);

    // Build a map from message id -> message for resolving reply_id references
    const replyMsgMap = React.useMemo(() => {
        const map = new Map<number, DooTaskDialogMsg>();
        for (const msg of messages) {
            if (!isPending(msg)) {
                map.set(msg.id, msg);
            }
        }
        return map;
    }, [messages]);

    const handleEndReached = React.useCallback(() => {
        if (hasMore && !loadingMore) {
            onLoadMore();
        }
    }, [hasMore, loadingMore, onLoadMore]);

    const renderItem = React.useCallback(({ item, index }: { item: DisplayMessage; index: number }) => {
        const pending = isPending(item);
        const bubbleMsg = pending ? buildFakeDooTaskMsg(item) : item;
        // 'sending-quiet' behaves like a real message for layout purposes (no forced avatar/spacing)
        const isQuietPending = pending && item._pending === 'sending-quiet';
        const isVisiblePending = pending && !isQuietPending;

        // Date separator logic:
        // The previous item is visually above this bubble in the non-inverted list.
        const currentDate = item.created_at.substring(0, 10); // YYYY-MM-DD
        const previousMsg = index > 0 ? chronologicalMessages[index - 1] : null;
        const previousDate = previousMsg ? previousMsg.created_at.substring(0, 10) : null;
        const showDateSeparator = !pending && (!previousDate || previousDate !== currentDate);

        // Avatar grouping: show avatar on the FIRST message of a sender group (reading top-to-bottom).
        // Show avatar when the message above is
        // from a different user or doesn't exist, OR when a date separator breaks the group.
        const isSystemMsg = (type: string) => type === 'notice' || type === 'tag' || type === 'top' || type === 'todo';
        const showAvatar = isVisiblePending || !previousMsg || previousMsg.userid !== item.userid || isSystemMsg(previousMsg.type) || showDateSeparator;

        // Spacing rule:
        // - Compact spacing for consecutive messages from the same sender (same date block)
        // - Larger spacing when a new sender group starts
        const isConsecutiveSameSender =
            !isVisiblePending &&
            !!previousMsg &&
            previousMsg.userid === item.userid &&
            !isSystemMsg(previousMsg.type) &&
            !isSystemMsg(item.type) &&
            !showDateSeparator;

        // Resolve reply message
        const replyMsg = item.reply_id ? replyMsgMap.get(item.reply_id) ?? null : null;
        const replySenderName = replyMsg
            ? (replyMsg.userid === AI_ASSISTANT_USERID ? t('dootask.aiAssistant') : userNames[replyMsg.userid])
            : undefined;

        return (
            // The last row's spacing would only add to the list's own bottom padding above the composer.
            <View style={[isConsecutiveSameSender ? styles.itemWithoutAvatar : styles.itemWithAvatar, index === chronologicalMessages.length - 1 && styles.lastItem]}>
                {showDateSeparator && (
                    <View style={styles.dateSeparator}>
                        <Text style={[styles.dateText, { color: theme.colors.textSecondary, backgroundColor: theme.colors.header.background }]}>
                            {currentDate.startsWith(new Date().getFullYear().toString()) ? currentDate.substring(5) : currentDate}
                        </Text>
                    </View>
                )}
                <ChatBubble
                    msg={bubbleMsg}
                    currentUserId={currentUserId}
                    senderName={item.userid === AI_ASSISTANT_USERID ? t('dootask.aiAssistant') : userNames[item.userid]}
                    avatarUrl={resolveAvatarUrl(userAvatars[item.userid], serverUrl)}
                    disabledAt={userDisabledAt[item.userid]}
                    showAvatar={showAvatar}
                    replyMsg={replyMsg}
                    replySenderName={replySenderName}
                    onImagePress={onImagePress}
                    onLongPress={onMessageLongPress}
                    onEmojiPress={onEmojiPress}
                    serverUrl={serverUrl}
                    pending={pending ? item._pending : undefined}
                    onRetry={pending ? () => onRetry?.(item._pendingId) : undefined}
                    userNames={userNames}
                />
            </View>
        );
    }, [chronologicalMessages, currentUserId, userNames, userAvatars, userDisabledAt, replyMsgMap, onImagePress, onMessageLongPress, onEmojiPress, onRetry, serverUrl, theme]);

    const keyExtractor = React.useCallback((msg: DisplayMessage) =>
        isPending(msg) ? msg._pendingId : msg.id.toString()
    , []);

    const listHeader = React.useMemo(() => (
        <View>
            <View style={{ height: softHeaderInset + 12 }} />
            {loadingMore && (
                <View style={styles.loadingFooter}>
                    <ActivityIndicator size="small" />
                </View>
            )}
        </View>
    ), [loadingMore, softHeaderInset, styles.loadingFooter]);

    // Refresh mounted rows when avatar data loads asynchronously.
    // The count is in here too: a new message takes the last-row spacing off the row before it.
    const extraData = React.useMemo(
        () => ({ userAvatars, userNames, userDisabledAt, count: chronologicalMessages.length }),
        [userAvatars, userNames, userDisabledAt, chronologicalMessages.length],
    );

    const renderScrollComponent = React.useCallback(
        (props: ScrollViewProps) => (
            <ChatScrollView
                {...props}
                bottomInset={composerInset ? floatingComposerBottomInset(insets.bottom) : insets.bottom}
                topInset={softHeaderInset}
                composerInset={composerInset}
            />
        ),
        [composerInset, insets.bottom, softHeaderInset],
    );
    // The list's frame does not shrink for the keyboard (or end at a floating composer), so the
    // scroll-to-bottom button is moved above both.
    const overlayStyle = useChatOverlayStyle(Platform.OS === 'ios', composerInset);

    return (
        <View style={styles.wrapper}>
            <LegendList
                ref={listRef}
                data={chronologicalMessages}
                dataKey={dataKey}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                estimatedItemSize={100}
                estimatedHeaderSize={softHeaderInset + 12 + (loadingMore ? 48 : 0)}
                alignItemsAtEnd
                initialScrollAtEnd
                maintainScrollAtEnd={{ on: { dataChange: true } }}
                maintainScrollAtEndThreshold={0.2}
                maintainVisibleContentPosition
                extraData={extraData}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onStartReached={handleEndReached}
                onStartReachedThreshold={0.3}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={emptyComponent}
                renderScrollComponent={renderScrollComponent}
                contentContainerStyle={styles.contentContainer}
                keyboardShouldPersistTaps="handled"
                // An empty chat only shows its centered placeholder; the composer's inset would
                // otherwise leave it a little room to scroll. The keyboard still lifts it (scrollTo).
                scrollEnabled={chronologicalMessages.length > 0}
            />

            {/* Scroll to bottom button */}
            <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, overlayStyle]}>
                {showScrollButton && (
                    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: 16, right: 16 }}>
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
                                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    </View>
                )}
            </Animated.View>
        </View>
    );
});

// --- Styles ---

const styles = StyleSheet.create((theme) => ({
    wrapper: {
        flex: 1,
    },
    contentContainer: {
        flexGrow: 1,
        paddingTop: theme.margins.sm,
        paddingBottom: COMPOSER_MARGIN,
    },
    itemWithAvatar: {
        marginBottom: 22,
    },
    itemWithoutAvatar: {
        marginBottom: 10,
    },
    lastItem: {
        marginBottom: 0,
    },
    dateSeparator: {
        alignItems: 'center',
        marginVertical: theme.margins.lg,
    },
    dateText: {
        ...Typography.default(),
        fontSize: 12,
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.xs,
        borderRadius: 999,
    },
    loadingFooter: {
        paddingVertical: theme.margins.lg,
        alignItems: 'center',
    },
}));

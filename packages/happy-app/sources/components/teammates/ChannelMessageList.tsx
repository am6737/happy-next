import * as React from 'react';
import { ActivityIndicator, Platform, Text, View, type ScrollViewProps } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import Animated, { FadeOut, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type { StoredChannelMessage } from '@/sync/channelReducers';
import { Typography } from '@/constants/Typography';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';
import { ChatScrollView } from '@/components/ChatScrollView';
import { ScrollToBottomButton } from '@/components/ScrollToBottomButton';
import { distanceFromEnd } from '@/components/chatListRowModel';
import { COMPOSER_MARGIN, floatingComposerBottomInset } from '@/components/floatingComposer';
import { useChatOverlayStyle } from '@/hooks/useChatOverlayStyle';
import { channelRowLayouts } from './channelMessageLayout';

// Distance from the end, in pixels, past which the scroll-to-bottom button shows.
const SCROLL_THRESHOLD = 100;

/**
 * The channel's messages in the DooTask chat list: chronological without inversion, pinned to the end
 * as messages arrive, older pages loaded on reaching the top, and date pills between days.
 */
export const ChannelMessageList = React.memo(({
    messages,
    renderMessage,
    extraData,
    hasMore,
    loadingMore,
    onLoadMore,
    dataKey,
    emptyComponent,
    composerInset,
    footer,
}: {
    /** Chronological, oldest first. */
    messages: StoredChannelMessage[];
    renderMessage: (message: StoredChannelMessage, header: boolean) => React.ReactNode;
    /** Whatever else `renderMessage` reads, so mounted rows refresh when it changes. */
    extraData: unknown;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    dataKey?: string;
    emptyComponent?: React.ReactElement | null;
    /** The height of a composer floating over the list (see `AgentContentView`'s `floatingInput`). */
    composerInset?: SharedValue<number>;
    /** Pinned after the last message, e.g. who is answering right now. */
    footer?: React.ReactElement | null;
}) => {
    const listRef = React.useRef<LegendListRef>(null);
    const softHeaderInset = useSoftHeaderInset();
    const insets = useSafeAreaInsets();
    const layouts = React.useMemo(() => channelRowLayouts(messages), [messages]);

    // The list lays out and scrolls to the end after its data arrives: a cover keeps that from showing as a blank page.
    const [readyKey, setReadyKey] = React.useState<string | undefined>(undefined);
    const covered = messages.length > 0 && readyKey !== dataKey;
    const handleReady = React.useCallback(() => setReadyKey(dataKey), [dataKey]);

    const [showScrollButton, setShowScrollButton] = React.useState(false);
    // The newest message when the button appeared: anything after it counts as unread.
    const lastSeenRef = React.useRef(messages[messages.length - 1]?.createdAt ?? 0);
    let unreadCount = 0;
    if (showScrollButton) {
        for (let index = messages.length - 1; index >= 0 && messages[index].createdAt > lastSeenRef.current; index--) unreadCount++;
    }
    const handleScroll = React.useCallback((event: any) => {
        const shouldShow = distanceFromEnd(event.nativeEvent) > SCROLL_THRESHOLD;
        setShowScrollButton(previous => {
            if (shouldShow && !previous) lastSeenRef.current = messages[messages.length - 1]?.createdAt ?? 0;
            return shouldShow;
        });
    }, [messages]);
    const handleScrollToBottom = React.useCallback(() => {
        void listRef.current?.scrollToEnd({ animated: false });
    }, []);
    const handleStartReached = React.useCallback(() => {
        if (hasMore && !loadingMore) onLoadMore();
    }, [hasMore, loadingMore, onLoadMore]);

    // The status row is a footer, which `maintainScrollAtEnd` does not follow: scroll to it when it appears, unless the user has scrolled up.
    const hasFooter = !!footer;
    React.useEffect(() => {
        if (!hasFooter || showScrollButton) return;
        const timer = setTimeout(() => { void listRef.current?.scrollToEnd({ animated: true }); }, 50);
        return () => clearTimeout(timer);
    }, [hasFooter]); // eslint-disable-line react-hooks/exhaustive-deps

    const renderItem = React.useCallback(({ item, index }: { item: StoredChannelMessage; index: number }) => {
        const layout = layouts[index];
        return (
            <View style={index === 0 ? undefined : layout.continued ? styles.itemContinued : styles.itemNewGroup}>
                {layout.date && (
                    <View style={styles.dateSeparator}>
                        <Text style={styles.dateText}>{layout.date}</Text>
                    </View>
                )}
                {renderMessage(item, layout.header)}
            </View>
        );
    }, [layouts, renderMessage]);
    const keyExtractor = React.useCallback((message: StoredChannelMessage) => message.localId ?? message.id, []);

    const listHeader = React.useMemo(() => (
        <View>
            <View style={{ height: softHeaderInset + 12 }} />
            {loadingMore && (
                <View style={styles.loadingMore}>
                    <ActivityIndicator size="small" />
                </View>
            )}
        </View>
    ), [loadingMore, softHeaderInset]);

    // Where the composer's padding ends above the screen's bottom, which its keyboard offset is measured from.
    const keyboardBottomInset = composerInset ? floatingComposerBottomInset(insets.bottom) : insets.bottom;
    const renderScrollComponent = React.useCallback((props: ScrollViewProps) => (
        <ChatScrollView
            {...props}
            bottomInset={keyboardBottomInset}
            topInset={softHeaderInset}
            composerInset={composerInset}
            listRef={listRef}
        />
    ), [composerInset, keyboardBottomInset, softHeaderInset]);
    // The list's frame does not shrink for the keyboard (or end at a floating composer), so the
    // scroll-to-bottom button is moved above both.
    const overlayStyle = useChatOverlayStyle(Platform.OS === 'ios', composerInset);
    const listExtraData = React.useMemo(() => ({ extraData, layouts }), [extraData, layouts]);

    return (
        <View style={styles.wrapper}>
            <LegendList
                ref={listRef}
                data={messages}
                dataKey={dataKey}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                estimatedItemSize={100}
                estimatedHeaderSize={softHeaderInset + 12 + (loadingMore ? 48 : 0)}
                initialScrollAtEnd
                maintainScrollAtEnd={{ on: { dataChange: true } }}
                maintainScrollAtEndThreshold={0.2}
                maintainVisibleContentPosition
                extraData={listExtraData}
                onReady={handleReady}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onStartReached={handleStartReached}
                onStartReachedThreshold={0.3}
                ListHeaderComponent={listHeader}
                ListFooterComponent={footer}
                ListEmptyComponent={emptyComponent}
                renderScrollComponent={renderScrollComponent}
                contentContainerStyle={[styles.contentContainer, messages.length === 0 && styles.contentContainerEmpty]}
                keyboardShouldPersistTaps="handled"
                // Taps near the header would otherwise send iOS's scroll-to-top to this list, which jumps it back through the history.
                scrollsToTop={false}
                // An empty chat only shows its centered placeholder; the composer's inset would
                // otherwise leave it a little room to scroll.
                scrollEnabled={messages.length > 0}
            />
            {covered && (
                <Animated.View exiting={FadeOut.duration(150)} style={styles.cover}>
                    <ActivityIndicator size="small" />
                </Animated.View>
            )}
            <Animated.View pointerEvents="box-none" style={[styles.overlay, overlayStyle]}>
                {showScrollButton && (
                    <View pointerEvents="box-none" style={styles.scrollButton}>
                        <ScrollToBottomButton onPress={handleScrollToBottom} unreadCount={unreadCount} />
                    </View>
                )}
            </Animated.View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    wrapper: {
        flex: 1,
    },
    contentContainer: {
        paddingTop: theme.margins.sm,
        paddingBottom: COMPOSER_MARGIN,
    },
    // Only an empty chat stretches to the viewport, for its centered placeholder.
    contentContainerEmpty: {
        flexGrow: 1,
    },
    itemNewGroup: {
        marginTop: 22,
    },
    itemContinued: {
        marginTop: 10,
    },
    dateSeparator: {
        alignItems: 'center',
        marginBottom: theme.margins.lg,
    },
    dateText: {
        ...Typography.default(),
        fontSize: 12,
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.xs,
        borderRadius: 999,
        overflow: 'hidden',
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.header.background,
    },
    loadingMore: {
        paddingVertical: theme.margins.lg,
        alignItems: 'center',
    },
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    cover: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    scrollButton: {
        position: 'absolute',
        bottom: 16,
        right: 16,
    },
}));

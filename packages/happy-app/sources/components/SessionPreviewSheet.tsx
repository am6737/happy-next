/**
 * SessionPreviewSheet Component
 *
 * A bottom sheet that displays a preview of Claude session messages.
 * Shows the last N messages from a session before resuming.
 * Supports drag-to-resize functionality.
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    Platform,
    FlatList,
    ActivityIndicator,
    Pressable,
    PanResponder,
    useWindowDimensions,
    ViewStyle,
    TextStyle,
    ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './StyledText';
import { layout } from './layout';
import { t } from '@/text';
import * as Clipboard from 'expo-clipboard';
import { handleCopyMenuContextMenu } from './copyMenuContextMenu';
import { getCopyMenuExpansionState } from './copyMenuExpansion';
import { hapticsLight } from './haptics';
import { resolveCopyMenuLayoutMeasurement } from './copyMenuLayout';
import { resolveCopyMenuPosition } from './copyMenuPosition';
import { createSheetMessageInteractionManager } from './sheetMessageInteraction';
import { isSessionPreviewMessageTruncated } from './sessionPreviewMenu';
import { isWebTextTruncated } from './webTextTruncation';
import { hasWebTextSelection } from './webTextSelection';
import { formatMessageTime } from '@/utils/messageTime';
import type { ClaudeSessionPreviewMessage, ClaudeSessionIndexEntry, AgentSessionIndexEntry } from '@/sync/ops';
import { GlassSurface, liquidGlassAvailable } from './GlassSurface';
import { GLASS_SHEET_FILL, GLASS_SHEET_RADIUS, glassSheetFramePadding, SHEET_BACKDROP_OPACITY, SHEET_SLIDE_SPRING } from './glassSheet';

// On web, stop events from propagating to expo-router's modal overlay
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webEventHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

interface SessionPreviewSheetProps {
    visible: boolean;
    entry: ClaudeSessionIndexEntry | AgentSessionIndexEntry | null;
    messages: ClaudeSessionPreviewMessage[] | null;
    loading: boolean;
    onClose: () => void;
    onResume: () => void;
    onClosed?: () => void; // Called after close animation completes
}

const ANIMATION_DURATION = 250;
const MIN_HEIGHT_RATIO = 0.3;
const MAX_HEIGHT_RATIO = 0.9;
const DEFAULT_HEIGHT_RATIO = 0.7;
const PREVIEW_COLLAPSED_LINES = 6;
const IS_WEB = Platform.OS === 'web';
interface CopyMenuState {
    x: number;
    y: number;
    content: string;
    messageKey: string;
}

function getPreviewMessageKey(message: ClaudeSessionPreviewMessage, index?: number): string {
    return `${message.role}:${message.timestamp || 'no-ts'}:${index ?? 0}`;
}

export function SessionPreviewSheet({
    visible,
    entry,
    messages,
    loading,
    onClose,
    onResume,
    onClosed,
}: SessionPreviewSheetProps) {
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const [modalVisible, setModalVisible] = useState(false);
    const [sheetHeight, setSheetHeight] = useState(windowHeight * DEFAULT_HEIGHT_RATIO);
    const [expandedMessageKeys, setExpandedMessageKeys] = useState<Set<string>>(new Set());
    const [truncatedMessageKeys, setTruncatedMessageKeys] = useState<Set<string>>(new Set());
    const webCollapsedTextRefs = useRef(new Map<string, HTMLElement>());
    const listRef = useRef<FlatList<ClaudeSessionPreviewMessage>>(null);
    // Web only: the upright list is hidden (loading shown on top) until it has been scrolled to the newest message.
    const [webPositioned, setWebPositioned] = useState(false);
    const webPositioningRef = useRef(false);
    const currentHeightRef = useRef(windowHeight * DEFAULT_HEIGHT_RATIO);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    // 0 = off screen, 1 = in place: the glass card (iOS 26) slides by its own height, see `glassSheet`.
    const slideAnim = useRef(new Animated.Value(0)).current;
    const dragStartY = useRef(0);
    const dragStartHeight = useRef(0);
    const messageInteractionManager = useRef(createSheetMessageInteractionManager()).current;
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copyMenu, setCopyMenu] = useState<CopyMenuState | null>(null);
    const copyMenuRef = useRef<CopyMenuState | null>(null);
    const copyMenuAnim = useRef(new Animated.Value(0)).current;
    const menuAnimStartedRef = useRef(false);
    const [copyMenuWidth, setCopyMenuWidth] = useState(0);
    const [copyMenuHeight, setCopyMenuHeight] = useState(0);
    const [localToastVisible, setLocalToastVisible] = useState(false);
    const localToastAnim = useRef(new Animated.Value(0)).current;
    // Cache entry for display during close animation
    const cachedEntryRef = useRef<ClaudeSessionIndexEntry | AgentSessionIndexEntry | null>(null);
    if (entry) {
        cachedEntryRef.current = entry;
    }

    const minHeight = windowHeight * MIN_HEIGHT_RATIO;
    const maxHeight = windowHeight * MAX_HEIGHT_RATIO;

    // Update ref when state changes
    const updateSheetHeight = (height: number) => {
        currentHeightRef.current = height;
        setSheetHeight(height);
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (_, gestureState) => {
                dragStartY.current = gestureState.y0;
                dragStartHeight.current = currentHeightRef.current;
            },
            onPanResponderMove: (_, gestureState) => {
                const deltaY = gestureState.moveY - dragStartY.current;
                const newHeight = dragStartHeight.current - deltaY;
                const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
                updateSheetHeight(clampedHeight);
            },
            onPanResponderRelease: (_, gestureState) => {
                // If dragged down significantly and quickly, close the sheet
                if (gestureState.vy > 0.5 && gestureState.dy > 50) {
                    onClose();
                }
            },
        })
    ).current;

    useEffect(() => {
        if (visible) {
            setModalVisible(true);
            updateSheetHeight(windowHeight * DEFAULT_HEIGHT_RATIO);
            fadeAnim.setValue(0);
            slideAnim.setValue(0);
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 1,
                    ...SHEET_SLIDE_SPRING,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (modalVisible) {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setModalVisible(false);
                onClosed?.();
            });
        }
    }, [visible, onClosed]);

    useEffect(() => {
        setExpandedMessageKeys(new Set());
        setTruncatedMessageKeys(new Set());
        webCollapsedTextRefs.current.clear();
        setCopyMenu(null);
    }, [entry?.sessionId, visible]);

    // Only re-hide the list when opening or switching session; resetting on close would flash the
    // loading overlay during the close animation.
    useEffect(() => {
        if (!visible) return;
        webPositioningRef.current = false;
        setWebPositioned(false);
    }, [entry?.sessionId, visible]);

    useEffect(() => {
        return () => {
            messageInteractionManager.dispose();
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, [messageInteractionManager]);

    const showCopyMenu = useCallback((menu: CopyMenuState) => {
        copyMenuRef.current = menu;
        copyMenuAnim.setValue(0);
        menuAnimStartedRef.current = false;
        setCopyMenuWidth(0);
        setCopyMenuHeight(0);
        setCopyMenu(menu);
    }, [copyMenuAnim]);

    const hideCopyMenu = useCallback(() => {
        copyMenuRef.current = null;
        Animated.timing(copyMenuAnim, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
        }).start(() => setCopyMenu(null));
    }, [copyMenuAnim]);

    const showLocalToast = useCallback(() => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setLocalToastVisible(true);
        localToastAnim.setValue(1);
        toastTimerRef.current = setTimeout(() => {
            toastTimerRef.current = null;
            Animated.timing(localToastAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
                setLocalToastVisible(false);
            });
        }, 1200);
    }, [localToastAnim]);

    const handleClose = () => {
        onClose();
    };

    const handleResume = () => {
        onResume();
    };

    const handleToggleMessageExpanded = useCallback((messageKey: string) => {
        setExpandedMessageKeys((prev) => {
            const next = new Set(prev);
            if (next.has(messageKey)) {
                next.delete(messageKey);
            } else {
                next.add(messageKey);
            }
            return next;
        });
    }, []);

    const setMessageTruncated = useCallback((messageKey: string, isTruncated: boolean) => {
        setTruncatedMessageKeys((prev) => {
            const hasMessageKey = prev.has(messageKey);

            if (hasMessageKey === isTruncated) {
                return prev;
            }

            const next = new Set(prev);
            if (isTruncated) {
                next.add(messageKey);
            } else {
                next.delete(messageKey);
            }
            return next;
        });
    }, []);

    const measureWebMessageTruncation = useCallback((messageKey: string) => {
        if (Platform.OS !== 'web') {
            return;
        }

        const node = webCollapsedTextRefs.current.get(messageKey);
        if (!node) {
            return;
        }

        setMessageTruncated(messageKey, isWebTextTruncated({
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
        }));
    }, [setMessageTruncated]);

    const setWebCollapsedTextRef = useCallback((messageKey: string) => (node: unknown) => {
        if (Platform.OS !== 'web') {
            return;
        }

        if (!node) {
            webCollapsedTextRefs.current.delete(messageKey);
            return;
        }

        webCollapsedTextRefs.current.set(messageKey, node as HTMLElement);
        requestAnimationFrame(() => measureWebMessageTruncation(messageKey));
    }, [measureWebMessageTruncation]);

    const handleMessageInteractionMove = useCallback(() => {
        messageInteractionManager.move();
    }, [messageInteractionManager]);

    const handleMessageInteractionCancel = useCallback(() => {
        messageInteractionManager.cancel();
    }, [messageInteractionManager]);

    const positionWebList = useCallback(() => {
        if (!IS_WEB || webPositioned || webPositioningRef.current) return;
        const node = listRef.current?.getScrollableNode();
        if (!node) return;

        // Scroll before paint, then once more next frame in case layout settled late (e.g. fonts).
        node.scrollTop = node.scrollHeight;
        webPositioningRef.current = true;
        requestAnimationFrame(() => {
            node.scrollTop = node.scrollHeight;
            webPositioningRef.current = false;
            setWebPositioned(true);
        });
    }, [webPositioned]);

    useLayoutEffect(() => {
        if (!loading) positionWebList();
    }, [loading, messages, modalVisible, positionWebList]);

    // Native uses an inverted list (newest first) to avoid a scroll flash. On web the list stays
    // upright because react-native-web's inverted wheel handler treats a line-clamped message as
    // scrollable and swallows the wheel delta, so scrolling gets stuck over long messages.
    const previewMessages = useMemo(() => {
        if (!messages) return [];
        return IS_WEB ? messages : [...messages].reverse();
    }, [messages]);

    if (!modalVisible) {
        return null;
    }

    // Use cached entry during close animation when entry becomes null
    const displayEntry = entry || cachedEntryRef.current;
    const title = displayEntry?.title || t('machine.untitledSession');
    const subtitle = displayEntry?.messageCount
        ? `${displayEntry.messageCount} messages${displayEntry.gitBranch ? ` \u2022 ${displayEntry.gitBranch}` : ''}`
        : displayEntry?.gitBranch || '';

    const hasOlderMessages = displayEntry?.messageCount && messages?.length
        ? displayEntry.messageCount > messages.length
        : false;
    const renderLoading = (style: ViewStyle[]) => (
        <View style={style}>
            <ActivityIndicator size="small" color="#8E8E93" />
            <Text style={styles.loadingText as TextStyle}>{t('common.loading')}</Text>
        </View>
    );
    const olderMessagesHint = hasOlderMessages ? (
        <Text style={styles.olderMessagesHint as TextStyle}>
            {t('sessionPreview.olderMessagesHint')}
        </Text>
    ) : null;
    const copyMenuPosition = copyMenu
        ? resolveCopyMenuPosition({
            triggerX: copyMenu.x,
            triggerY: copyMenu.y,
            menuWidth: copyMenuWidth,
            menuHeight: copyMenuHeight,
            viewportWidth: windowWidth,
            viewportHeight: windowHeight,
        })
        : null;
    const copyMenuExpansion = copyMenu
        ? getCopyMenuExpansionState({
            target: copyMenu.messageKey,
            truncatedTargets: truncatedMessageKeys,
            expandedTargets: expandedMessageKeys,
        })
        : null;

    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="none"
            onRequestClose={handleClose}
        >
            <View style={[styles.container as ViewStyle, Platform.OS === 'web' && { pointerEvents: 'auto' as const }]} {...webEventHandlers}>
                <TouchableWithoutFeedback onPress={handleClose}>
                    <Animated.View
                        style={[
                            styles.backdrop as ViewStyle,
                            {
                                opacity: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, SHEET_BACKDROP_OPACITY],
                                }),
                            },
                        ]}
                    />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.sheetFrame as ViewStyle,
                        liquidGlassAvailable && glassSheetFramePadding(insets.bottom),
                        {
                            opacity: liquidGlassAvailable ? 1 : fadeAnim,
                            transform: [{
                                translateY: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [liquidGlassAvailable ? sheetHeight + insets.bottom : 300, 0],
                                }),
                            }],
                        },
                    ]}
                >
                    <GlassSurface
                        glass={liquidGlassAvailable}
                        color={theme.colors.surface}
                        style={[
                            styles.sheet as ViewStyle,
                            liquidGlassAvailable ? styles.sheetGlass as ViewStyle : styles.sheetSolid as ViewStyle,
                            { height: sheetHeight, paddingBottom: liquidGlassAvailable ? 0 : insets.bottom },
                        ]}
                    >
                        {/* Handle - draggable */}
                        <View
                            style={[styles.handleContainer as ViewStyle, Platform.OS === 'web' && { cursor: 'ns-resize' as any }]}
                            {...panResponder.panHandlers}
                        >
                            <View style={styles.handle as ViewStyle} />
                        </View>

                        {/* Header */}
                        <View style={styles.header as ViewStyle}>
                            <View style={styles.headerIcon as ViewStyle}>
                                <Ionicons name="chatbubbles" size={20} color="#fff" />
                            </View>
                            <View style={styles.headerContent as ViewStyle}>
                                <Text style={styles.title as TextStyle} numberOfLines={1}>{title}</Text>
                                {subtitle ? <Text style={styles.subtitle as TextStyle}>{subtitle}</Text> : null}
                            </View>
                            <Pressable style={styles.closeButton as ViewStyle} onPress={handleClose}>
                                <Ionicons name="close" size={18} color="#8E8E93" />
                            </Pressable>
                        </View>

                        {/* Content - native uses an inverted FlatList to avoid scroll flash; web stays hidden behind the loading state until scrolled to the end */}
                        {loading ? (
                            renderLoading([styles.content as ViewStyle, styles.loadingContainer as ViewStyle])
                        ) : (
                            <View style={styles.content as ViewStyle}>
                                <FlatList
                                    ref={listRef}
                                    data={previewMessages}
                                    inverted={!IS_WEB}
                                    initialNumToRender={IS_WEB ? previewMessages.length : undefined}
                                    onContentSizeChange={IS_WEB ? positionWebList : undefined}
                                    style={[styles.content as ViewStyle, IS_WEB && !webPositioned && styles.listHidden as ViewStyle]}
                                    contentContainerStyle={styles.contentContainer as ViewStyle}
                                    onScroll={handleMessageInteractionMove}
                                    scrollEventThrottle={16}
                                    onScrollBeginDrag={hideCopyMenu}
                                    showsVerticalScrollIndicator={false}
                                    keyExtractor={getPreviewMessageKey}
                                    renderItem={({ item: msg, index }: ListRenderItemInfo<ClaudeSessionPreviewMessage>) => {
                                        const messageKey = getPreviewMessageKey(msg, index);
                                        const isExpanded = expandedMessageKeys.has(messageKey);
                                        const isLong = truncatedMessageKeys.has(messageKey);
                                        const messageTimestamp = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
                                        const messageTime = Number.isNaN(messageTimestamp) ? null : formatMessageTime(messageTimestamp);
                                        const openCopyMenu = ({ pageX, pageY }: { pageX: number; pageY: number }) => {
                                            showCopyMenu({ x: pageX, y: pageY, content: msg.content, messageKey });
                                        };
                                        const interactionCallbacks = {
                                            onTap: () => {
                                                if (copyMenuRef.current !== null) {
                                                    hideCopyMenu();
                                                    return;
                                                }
    
                                                handleToggleMessageExpanded(messageKey);
                                            },
                                            onLongPress: ({ pageX, pageY }: { pageX: number; pageY: number }) => {
                                                hapticsLight();
                                                openCopyMenu({ pageX, pageY });
                                            },
                                        };
                                        const webMouseHandlers = Platform.OS === 'web'
                                            ? {
                                                // Mouse users select text by dragging, so no press-and-hold menu here.
                                                onMouseDown: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
                                                    messageInteractionManager.start(e, { ...interactionCallbacks, onLongPress: () => {} });
                                                },
                                                onMouseMove: handleMessageInteractionMove,
                                                // A drag-select must not count as a tap (which would expand/collapse the message).
                                                onMouseUp: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
                                                    if (hasWebTextSelection()) {
                                                        messageInteractionManager.cancel();
                                                        return;
                                                    }
                                                    messageInteractionManager.end(e);
                                                },
                                                onMouseLeave: handleMessageInteractionCancel,
                                                onContextMenu: (e: { preventDefault: () => void; nativeEvent: { pageX: number; pageY: number } }) => {
                                                    // Keep the browser's native menu when text is selected so "Copy" copies the selection.
                                                    if (hasWebTextSelection()) return;
                                                    handleCopyMenuContextMenu(e, openCopyMenu);
                                                },
                                            }
                                            : {};
    
                                        return (
                                            <View
                                                style={[
                                                    styles.message as ViewStyle,
                                                    msg.role === 'user' ? styles.userMessage as ViewStyle : styles.assistantMessage as ViewStyle,
                                                ]}
                                            >
                                                <View
                                                    style={[
                                                        styles.messageBubble as ViewStyle,
                                                        msg.role === 'user' ? styles.userBubble as ViewStyle : styles.assistantBubble as ViewStyle,
                                                    ]}
                                                    onTouchStart={(e) => {
                                                        messageInteractionManager.start(e, interactionCallbacks);
                                                    }}
                                                    onTouchMove={handleMessageInteractionMove}
                                                    onTouchEnd={messageInteractionManager.end}
                                                    onTouchCancel={handleMessageInteractionCancel}
                                                    {...webMouseHandlers}
                                                >
                                                    <Text
                                                        selectable={IS_WEB}
                                                        ref={Platform.OS === 'web' && !isExpanded ? setWebCollapsedTextRef(messageKey) : undefined}
                                                        style={[
                                                            styles.messageText as TextStyle,
                                                            msg.role === 'user' ? styles.userText as TextStyle : styles.assistantText as TextStyle,
                                                        ]}
                                                        numberOfLines={isExpanded ? undefined : PREVIEW_COLLAPSED_LINES}
                                                        onLayout={Platform.OS === 'web' && !isExpanded ? () => measureWebMessageTruncation(messageKey) : undefined}
                                                    >
                                                        {msg.content}
                                                    </Text>
                                                    {messageTime ? (
                                                        <Text
                                                            style={[
                                                                styles.messageTime as TextStyle,
                                                                msg.role === 'user' ? styles.userText as TextStyle : styles.assistantText as TextStyle,
                                                                { textAlign: msg.role === 'user' ? 'right' : 'left' },
                                                            ]}
                                                        >
                                                            {messageTime}
                                                        </Text>
                                                    ) : null}
                                                    {Platform.OS !== 'web' && !isExpanded && !isLong && (
                                                        <Text
                                                            style={[
                                                                styles.messageText as TextStyle,
                                                                styles.measureText as TextStyle,
                                                                msg.role === 'user' ? styles.userText as TextStyle : styles.assistantText as TextStyle,
                                                            ]}
                                                            pointerEvents="none"
                                                            onTextLayout={(e) => {
                                                                if (isSessionPreviewMessageTruncated({
                                                                    lineCount: e.nativeEvent.lines.length,
                                                                    collapsedLineCount: PREVIEW_COLLAPSED_LINES,
                                                                })) {
                                                                    setMessageTruncated(messageKey, true);
                                                                }
                                                            }}
                                                        >
                                                            {msg.content}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        );
                                    }}
                                    ListEmptyComponent={
                                        <View style={styles.emptyContainer as ViewStyle}>
                                            <Text style={styles.emptyText as TextStyle}>{t('sessionPreview.noMessages')}</Text>
                                        </View>
                                    }
                                    ListHeaderComponent={IS_WEB ? olderMessagesHint : undefined}
                                    ListFooterComponent={IS_WEB ? undefined : olderMessagesHint}
                                />
                            {IS_WEB && !webPositioned && renderLoading([styles.loadingOverlay as ViewStyle, styles.loadingContainer as ViewStyle])}
                            </View>
                        )}

                        {/* Footer */}
                        <View style={styles.footer as ViewStyle}>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.resumeButton as ViewStyle,
                                    pressed && styles.resumeButtonPressed as ViewStyle,
                                ]}
                                onPress={handleResume}
                            >
                                <Ionicons name="play" size={18} color="#fff" />
                                <Text style={styles.resumeButtonText as TextStyle}>{t('sessionPreview.resume')}</Text>
                            </Pressable>
                        </View>
                    </GlassSurface>
                </Animated.View>

                {/* Copy menu overlay — rendered at modal level to avoid clipping */}
                {copyMenu && (
                    <>
                        <TouchableWithoutFeedback onPress={hideCopyMenu}>
                            <View style={styles.copyMenuBackdrop as ViewStyle} />
                        </TouchableWithoutFeedback>
                        <Animated.View
                            style={[
                                styles.copyMenuContainer as ViewStyle,
                                { left: copyMenuPosition?.left ?? 0, top: copyMenuPosition?.top ?? 0 },
                                {
                                    opacity: copyMenuAnim,
                                    transform: [
                                        { scale: copyMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                                    ],
                                },
                            ]}
                            pointerEvents="box-none"
                            onLayout={(e) => {
                                const { width, height } = e.nativeEvent.layout;
                                const { nextWidth, shouldStartAnimation } = resolveCopyMenuLayoutMeasurement({
                                    animationStarted: menuAnimStartedRef.current,
                                    measuredWidth: width,
                                });
                                setCopyMenuWidth(nextWidth);
                                setCopyMenuHeight(height);

                                if (shouldStartAnimation) {
                                    menuAnimStartedRef.current = true;
                                    Animated.spring(copyMenuAnim, {
                                        toValue: 1,
                                        damping: 15,
                                        stiffness: 300,
                                        useNativeDriver: true,
                                    }).start();
                                }
                            }}
                        >
                            <View style={styles.copyMenuRow as ViewStyle}>
                                <Pressable
                                    style={styles.copyMenuButton as ViewStyle}
                                    onPress={() => {
                                        Clipboard.setStringAsync(copyMenu.content);
                                        hapticsLight();
                                        showLocalToast();
                                        hideCopyMenu();
                                    }}
                                >
                                    <Text style={styles.copyMenuText as TextStyle}>{t('common.copy')}</Text>
                                </Pressable>
                                {copyMenuExpansion?.toggleAction && (
                                    <>
                                        <View style={styles.copyMenuDivider as ViewStyle} />
                                        <Pressable
                                            style={styles.copyMenuButton as ViewStyle}
                                            onPress={() => {
                                                handleToggleMessageExpanded(copyMenu.messageKey);
                                                hideCopyMenu();
                                            }}
                                        >
                                            <Text style={styles.copyMenuText as TextStyle}>
                                                {copyMenuExpansion.toggleAction === 'collapse'
                                                    ? t('duplicate.collapseText')
                                                    : t('duplicate.expandText')}
                                            </Text>
                                        </Pressable>
                                    </>
                                )}
                            </View>
                            <View
                                style={[
                                    styles.copyMenuArrow as ViewStyle,
                                    { marginLeft: copyMenuPosition?.arrowLeft ?? 0 },
                                ]}
                            />
                        </Animated.View>
                    </>
                )}

                {/* Local toast inside Modal to avoid being covered */}
                {localToastVisible && (
                    <Animated.View pointerEvents="none" style={[styles.localToast as ViewStyle, { opacity: localToastAnim }]}>
                        <Ionicons name="checkmark-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
                        <Text style={styles.localToastText as TextStyle}>{t('common.copied')}</Text>
                    </Animated.View>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'black',
    },
    sheetFrame: {
        width: '100%',
        maxWidth: Math.min(layout.maxWidth, 768),
    },
    sheet: {
        overflow: 'hidden',
    },
    sheetSolid: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sheetGlass: {
        borderRadius: GLASS_SHEET_RADIUS,
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    handle: {
        width: 36,
        height: 5,
        backgroundColor: theme.colors.divider,
        borderRadius: 2.5,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
        gap: 12,
    },
    headerIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: '#D97757',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerContent: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: liquidGlassAvailable ? GLASS_SHEET_FILL : theme.colors.surfacePressed,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        gap: 12,
        flexGrow: 1,
    },
    loadingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        gap: 12,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    listHidden: {
        opacity: 0,
    },
    loadingText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    olderMessagesHint: {
        textAlign: 'center',
        fontSize: 13,
        color: theme.colors.textSecondary,
        paddingVertical: 8,
        marginTop: 4,
    },
    message: {
        maxWidth: '85%',
    },
    userMessage: {
        alignSelf: 'flex-end',
    },
    assistantMessage: {
        alignSelf: 'flex-start',
    },
    messageBubble: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 16,
    },
    userBubble: {
        backgroundColor: theme.colors.userMessageBackground,
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        backgroundColor: liquidGlassAvailable ? GLASS_SHEET_FILL : theme.colors.surfacePressed,
        borderBottomLeftRadius: 4,
    },
    messageText: {
        fontSize: 15,
        lineHeight: 20,
    },
    messageTime: {
        fontSize: 11,
        lineHeight: 14,
        marginTop: 4,
        opacity: 0.6,
    },
    userText: {
        color: theme.colors.userMessageText,
    },
    assistantText: {
        color: theme.colors.agentMessageText,
    },
    measureText: {
        position: 'absolute',
        opacity: 0,
        left: 0,
        right: 0,
    },
    footer: {
        padding: 16,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    resumeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#000',
        paddingVertical: 14,
        borderRadius: 10,
    },
    resumeButtonPressed: {
        backgroundColor: '#1a1a1a',
    },
    resumeButtonText: {
        fontSize: 17,
        fontWeight: '500',
        color: '#fff',
    },
    copyMenuBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    copyMenuContainer: {
        position: 'absolute',
        alignItems: 'flex-start',
    },
    copyMenuRow: {
        flexDirection: 'row',
        backgroundColor: '#232325',
        borderRadius: 8,
        overflow: 'hidden',
        zIndex: 1,
    },
    copyMenuButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    copyMenuDivider: {
        width: 0.5,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignSelf: 'stretch',
    },
    copyMenuText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '500',
    },
    copyMenuArrow: {
        width: 8,
        height: 8,
        backgroundColor: '#232325',
        transform: [{ rotate: '45deg' }],
        marginTop: -4,
    },
    localToast: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 100 : 80,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
    },
    localToastText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
}));

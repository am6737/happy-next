import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { UserTextMessage } from '@/sync/typesMessage';
import { formatMessageTime } from '@/utils/messageTime';

export type ConversationMinimapItem = {
    message: UserTextMessage;
    index: number;
};

const HIT_WIDTH = 44;
const MARKER_WIDTH = 7;
const MARKER_HEIGHT = 2;
const MARKER_SLOT_HEIGHT = 10;
const MIN_VISIBLE_ITEMS = 8;

function getHoverScale(distance: number) {
    if (distance <= 0) return 4;
    if (distance === 1) return 3.4;
    if (distance === 2) return 2.8;
    if (distance === 3) return 2.2;
    if (distance === 4) return 1.6;
    return 1;
}
const MAX_PREVIEW_CHARS = 180;
const PREVIEW_WIDTH = 260;
const MIN_CONTENT_WIDTH = 840;

function getPreviewText(message: UserTextMessage) {
    const raw = (message.displayText || message.text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '(empty message)';
    return raw.length > MAX_PREVIEW_CHARS ? `${raw.slice(0, MAX_PREVIEW_CHARS - 1)}…` : raw;
}

function getAttachmentSummary(message: UserTextMessage) {
    const images = message.images ?? [];
    if (images.length === 0) return null;
    const kinds = Array.from(new Set(images.map((image) => image.mimeType || 'image')));
    const kindText = kinds.length === 1 ? kinds[0] : kinds.join(', ');
    return `${images.length} attachment${images.length === 1 ? '' : 's'} · ${kindText}`;
}

export function ConversationMinimap(props: {
    userMessages: ConversationMinimapItem[];
    activeMessageIds: Set<string>;
    onJumpToMessage: (index: number) => void;
    contentWidth: number;
}) {
    const { theme } = useUnistyles();
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [availableHeight, setAvailableHeight] = React.useState(0);

    const activeIndex = React.useMemo(() => {
        const index = props.userMessages.findIndex((item) => props.activeMessageIds.has(item.message.id));
        return index >= 0 ? index : Math.max(0, props.userMessages.length - 1);
    }, [props.userMessages, props.activeMessageIds]);

    const maxVisibleItems = React.useMemo(() => {
        if (availableHeight <= 0) return props.userMessages.length;
        return Math.max(MIN_VISIBLE_ITEMS, Math.floor(availableHeight / MARKER_SLOT_HEIGHT));
    }, [availableHeight, props.userMessages.length]);

    const visibleWindow = React.useMemo(() => {
        const total = props.userMessages.length;
        const count = Math.min(total, maxVisibleItems);
        let start = activeIndex - Math.floor(count / 2);
        start = Math.max(0, Math.min(start, Math.max(0, total - count)));
        const end = Math.min(total, start + count);
        return { start, end, items: props.userMessages.slice(start, end) };
    }, [props.userMessages, activeIndex, maxVisibleItems]);

    React.useEffect(() => {
        setHoveredIndex(null);
    }, [visibleWindow.start, visibleWindow.end]);

    const webHoverHandlers = {
        onMouseMove: (event: any) => {
            const rect = event.currentTarget?.getBoundingClientRect?.();
            if (!rect || visibleWindow.items.length === 0) return;
            const y = event.clientY - rect.top;
            const nextIndex = Math.max(0, Math.min(visibleWindow.items.length - 1, Math.floor(y / MARKER_SLOT_HEIGHT)));
            setHoveredIndex(nextIndex);
        },
        onMouseLeave: () => setHoveredIndex(null),
    };

    if (Platform.OS !== 'web' || props.contentWidth < MIN_CONTENT_WIDTH || props.userMessages.length < 2) {
        return null;
    }

    return (
        <View
            pointerEvents="box-none"
            onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)}
            style={{
                position: 'absolute',
                top: '15%',
                bottom: '15%',
                left: 8,
                width: HIT_WIDTH + PREVIEW_WIDTH + 16,
                justifyContent: 'center',
                zIndex: 1001,
            }}
        >
            <View
                {...webHoverHandlers}
                style={{
                    width: HIT_WIDTH,
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                }}
            >
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: 1,
                        borderRadius: 1,
                        backgroundColor: theme.colors.divider,
                        opacity: 0.55,
                    }}
                />

                {visibleWindow.items.map((item, itemIndex) => {
                    const isActive = hoveredIndex === null && props.activeMessageIds.has(item.message.id);
                    const hoverScale = hoveredIndex === null ? 1 : getHoverScale(Math.abs(hoveredIndex - itemIndex));
                    const isHovered = hoveredIndex === itemIndex;
                    const markerWidth = MARKER_WIDTH * hoverScale;
                    const attachmentSummary = getAttachmentSummary(item.message);
                    return (
                        <View key={item.message.id} style={{ position: 'relative', width: HIT_WIDTH, height: MARKER_SLOT_HEIGHT, alignItems: 'flex-start', justifyContent: 'center' }}>
                            <Pressable
                                onPress={() => props.onJumpToMessage(item.index)}
                                onHoverIn={() => setHoveredIndex(itemIndex)}
                                accessibilityRole="button"
                                accessibilityLabel="Jump to user message"
                                style={{
                                    width: HIT_WIDTH,
                                    height: MARKER_SLOT_HEIGHT,
                                    alignItems: 'flex-start',
                                    justifyContent: 'center',
                                    cursor: 'pointer' as any,
                                }}
                            >
                                <View
                                    style={{
                                        width: markerWidth,
                                        height: MARKER_HEIGHT,
                                        borderRadius: 4,
                                        backgroundColor: isActive || isHovered ? theme.colors.text : theme.colors.textSecondary,
                                        opacity: isActive ? 0.95 : isHovered ? 0.9 : 0.45,
                                        transitionProperty: 'width, opacity, background-color',
                                        transitionDuration: '140ms',
                                        transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                                    } as any}
                                />
                            </Pressable>
                            {isHovered && (
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: 'absolute',
                                        top: -44,
                                        left: HIT_WIDTH + 8,
                                        width: PREVIEW_WIDTH,
                                        borderRadius: 12,
                                        paddingHorizontal: 12,
                                        paddingVertical: 10,
                                        backgroundColor: 'rgba(18, 18, 20, 0.88)',
                                        borderWidth: 1,
                                        borderColor: 'rgba(255, 255, 255, 0.12)',
                                        shadowColor: '#000',
                                        shadowOpacity: 0.25,
                                        shadowRadius: 14,
                                        shadowOffset: { width: 0, height: 8 },
                                    }}
                                >
                                    <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, marginBottom: 6 }}>
                                        {formatMessageTime(item.message.createdAt)}
                                    </Text>
                                    <Text numberOfLines={5} style={{ color: '#fff', fontSize: 13, lineHeight: 18 }}>
                                        {getPreviewText(item.message)}
                                    </Text>
                                    {attachmentSummary ? (
                                        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.64)', fontSize: 11, marginTop: 7 }}>
                                            {attachmentSummary}
                                        </Text>
                                    ) : null}
                                </View>
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

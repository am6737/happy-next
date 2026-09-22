import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { MinimapMessage } from '@/sync/typesMessage';
import {
    MARKER_HEIGHT,
    MARKER_SLOT_HEIGHT,
    MARKER_WIDTH,
    MIN_ITEMS,
    getHoverScale,
    maxVisibleSlots,
    windowStartFor,
} from './minimapScrubber';
import { MinimapPreviewCard, PREVIEW_WIDTH } from './minimapPreview';
import { ConversationMinimapTouch } from './ConversationMinimapTouch';

export type ConversationMinimapItem = {
    message: MinimapMessage;
};

/** The moments a touch at the screen edge is reported at, once for each. */
export type ConversationMinimapEdgeTouchPhase = 'start' | 'move' | 'end';

/**
 * How the summoning swipe is reported from outside the rail, by a `View` that can see the touches the
 * message list is handling. The coordinates are in window space; see `ConversationMinimapTouch.onEdgeTouch`.
 */
export type ConversationMinimapEdgeTouch = (
    phase: ConversationMinimapEdgeTouchPhase,
    pageX: number,
    pageY: number,
) => void;

export type ConversationMinimapProps = {
    userMessages: ConversationMinimapItem[];
    /**
     * The landmark the reader is on, as the message list reports it — or `null` before the list has
     * said. The rail draws exactly one lit mark, so this is one id and not a set; see
     * `currentLandmark` for how the list decides which.
     */
    activeMessageId: string | null;
    /**
     * Move the reader to this landmark. A list that has to page older messages in before it can move
     * answers late, and reports that by returning a promise; see the touch rail, which stays up until
     * it settles.
     */
    onJumpToMessage: (message: MinimapMessage) => void | Promise<void>;
    contentWidth: number;
    /**
     * Touch has no hover, and the rail cannot watch the screen edge itself without taking the edge away
     * from the message list — a touch zone is a touch zone. So it listens from the outside instead: the
     * host screen hands it the edge's touches through here, and the rail decides what they mean. Not
     * used on web, where the rail is driven by hover.
     */
    onRegisterMinimapEdgeTouch?: (listener: ConversationMinimapEdgeTouch | null) => void;
};

const HIT_WIDTH = 44;
const MIN_CONTENT_WIDTH = 840;

export function ConversationMinimap(props: ConversationMinimapProps) {
    // A phone has no hover, so touch gets a rail that is swiped in from the right edge instead.
    if (Platform.OS !== 'web') {
        return <ConversationMinimapTouch {...props} />;
    }
    return <WebMinimap {...props} />;
}

/** Left-edge rail: the pointer is the scrubber, the preview follows the hovered mark. */
function WebMinimap(props: ConversationMinimapProps) {
    const { theme } = useUnistyles();
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [availableHeight, setAvailableHeight] = React.useState(0);

    // Where the rail rests: the landmark the reader is on, or the newest one when the list has not
    // named it yet — the rail is read from the bottom of the conversation far more often than not.
    const activeIndex = React.useMemo(() => {
        const index = props.userMessages.findIndex((item) => item.message.id === props.activeMessageId);
        return index >= 0 ? index : Math.max(0, props.userMessages.length - 1);
    }, [props.userMessages, props.activeMessageId]);

    const visibleWindow = React.useMemo(() => {
        const total = props.userMessages.length;
        const slots = maxVisibleSlots(availableHeight, MARKER_SLOT_HEIGHT, total);
        const start = windowStartFor(activeIndex, slots, total);
        return { start, end: start + slots, items: props.userMessages.slice(start, start + slots) };
    }, [props.userMessages, activeIndex, availableHeight]);

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

    if (props.contentWidth < MIN_CONTENT_WIDTH || props.userMessages.length < MIN_ITEMS) {
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
                marginTop: -56, // offset for the top bar
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
                        backgroundColor: theme.colors.transparent,
                        opacity: 0.55,
                    }}
                />

                {visibleWindow.items.map((item, itemIndex) => {
                    const isActive = hoveredIndex === null && item.message.id === props.activeMessageId;
                    const hoverScale = hoveredIndex === null ? 1 : getHoverScale(Math.abs(hoveredIndex - itemIndex));
                    const isHovered = hoveredIndex === itemIndex;
                    const markerWidth = MARKER_WIDTH * hoverScale;
                    // AskUserQuestion markers are drawn exactly like prompts: the rail is a neutral
                    // map of landmarks, and hovering is what tells you which mark is a question.
                    // Every landmark is drawn as the same mark; hovering — or the screen reader —
                    // is what tells a question, a preview and a plan proposal apart from a prompt.
                    const jumpLabel = item.message.kind === 'ask-user-question'
                        ? 'Jump to question'
                        : item.message.kind === 'preview-html'
                            ? 'Jump to preview'
                            : item.message.kind === 'plan-proposal'
                                ? 'Jump to plan'
                                : 'Jump to user message';
                    return (
                        <View key={item.message.id} style={{ position: 'relative', width: HIT_WIDTH, height: MARKER_SLOT_HEIGHT, alignItems: 'flex-start', justifyContent: 'center' }}>
                            <Pressable
                                onPress={() => props.onJumpToMessage(item.message)}
                                onHoverIn={() => setHoveredIndex(itemIndex)}
                                accessibilityRole="button"
                                accessibilityLabel={jumpLabel}
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
                                <MinimapPreviewCard
                                    message={item.message}
                                    style={{ position: 'absolute', top: -44, left: HIT_WIDTH + 8 }}
                                />
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

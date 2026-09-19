import * as React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';
import type { ConversationMinimapEdgeTouchPhase, ConversationMinimapProps } from './ConversationMinimap';
import { hapticsHeavy, hapticsLight } from './haptics';
import { MinimapPreviewCard, PREVIEW_WIDTH } from './minimapPreview';
import {
    MARKER_HEIGHT,
    MARKER_WIDTH,
    MIN_ITEMS,
    MIN_TICK_INTERVAL_MS,
    TOUCH_SLOT_HEIGHT,
    cardTopAtOffset,
    clamp,
    createTickGate,
    getHoverScale,
    indexAtRail,
    railTopForWindow,
    readEdgeSwipe,
    scrubLayout,
    windowStartFor,
    type ScrubBand,
    type ScrubLayout,
} from './minimapScrubber';

/**
 * Touch zone: the marks' own rectangle, and only while the rail is drawn. It is flush with the right
 * edge because the rail is, and it takes touches only for the rail — a finger landing on the empty band
 * above or below a short rail, or lower over the input row, is nowhere near a landmark and has no
 * business picking one.
 *
 * While the rail is hidden this zone takes no touches at all (`pointerEvents` in the render): the right
 * edge then belongs to the list like every other part of the screen, so it scrolls. The swipe that
 * summons the rail is heard from outside instead — see `onEdgeTouch`.
 */
const RAIL_INSET = 8;
const RAIL_WIDTH = 36;
/** Distance from the screen's right edge to the touch zone's left edge. */
const ZONE_OFFSET = RAIL_INSET + RAIL_WIDTH;
/** The band the rail lives in, as fractions of the overlay: the bottom one keeps the input row clear. */
const BAND_TOP_RATIO = 0.12;
const BAND_BOTTOM_RATIO = 0.24;
/** Movement needed before the gesture is active at all; a motionless tap must not count. */
const MIN_DRAG = 2;
const CARD_GAP = 8;
const REVEAL_MS = 180;
const HIDE_MS = 220;
const CARD_MS = 120;
/** How long the rail waits for the next touch after the finger leaves, before fading out. */
const LINGER_MS = 3000;
/**
 * The longest the rail will wait on a jump that has not answered. Paging a long way back is several
 * round trips and the rail is meant to stay for all of them, but a fetch that never comes back must
 * not pin it to the screen — past this it fades like any other and the list carries on by itself.
 */
const LOCATE_HOLD_MAX_MS = 8000;
/** How far the rail slides in from the edge while it appears. */
const SLIDE_IN = 14;
const MIN_BAND_HEIGHT = TOUCH_SLOT_HEIGHT * 4;
/**
 * Where a finger gives up on the pick, as a fraction of the overlay's width: crossing into the left
 * two thirds means the thumb has left the rail's side of the screen, and it is not aiming at anything
 * on a rail pinned to the right edge any more. The real press lands here long before that.
 */
const CANCEL_LEFT_RATIO = 2 / 3;

/**
 * Right-edge rail for touch: swiping in from the edge shows it, sliding a finger along it picks a
 * landmark — a card previews it, a light tick confirms each step — with the lift jumping there.
 *
 * Two separate touches, on purpose. The swipe that brings the rail out only displays it: nothing is
 * picked by accident, the finger may stay or leave, and the rail waits LINGER_MS after the finger
 * leaves before fading out. Touching the rail again is what starts the walk — that touch is a drag,
 * and releasing it after moving picks the landmark it stopped on. Splitting the two means the rail
 * can be summoned first and aimed afterwards, and that the swipe-in cannot land on a landmark the
 * finger merely passed over.
 *
 * The rail is a fixed window of marks centred on the landmark the reader is on — the finger slides
 * over it, the marks do not move, and the preview is whatever mark is under the finger. That window is
 * frozen for as long as a touch is in play: a jump moves the reader, and re-centring the map on the new
 * position would slide the marks out from under the finger at the very moment the finger leaves.
 *
 * While the keyboard is up the rail is neither drawn nor reachable: the conversation is being typed
 * into, and an edge that both scrolls and reveals would be in the way of the thumb.
 *
 * The edge is heard, not owned. A touch zone sitting on the right edge would take the touch from the
 * list underneath it, and the list would stop scrolling along that edge; so while the rail is hidden
 * the edge is watched by a listener on an ancestor of the list (`onRegisterMinimapEdgeTouch`), which
 * sees the touches the list is handling without taking any of them.
 */
export function ConversationMinimapTouch(props: ConversationMinimapProps) {
    const { theme } = useUnistyles();
    const keyboardVisible = useKeyboardVisible();
    const [rootHeight, setRootHeight] = React.useState(0);
    const [visible, setVisible] = React.useState(false);
    /**
     * Where the drawn window is anchored, once a touch has pinned it; `null` means it follows the
     * reader's landmark. It only returns to following once the rail has faded out.
     */
    const [anchorIndex, setAnchorIndex] = React.useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
    /** Kept after the finger leaves so the card can fade out instead of vanishing; cleared with the rail. */
    const [cardIndex, setCardIndex] = React.useState<number | null>(null);

    // The rail's own fade is native driven (opacity + slide); the card's position comes from the JS
    // side of the gesture, so its fade is JS driven too — a view mixes the two only at its peril.
    const revealAnim = React.useRef(new Animated.Value(0)).current;
    const cardY = React.useRef(new Animated.Value(0)).current;
    const cardFade = React.useRef(new Animated.Value(0)).current;
    const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickGateRef = React.useRef(createTickGate(MIN_TICK_INTERVAL_MS));
    const fingerYRef = React.useRef(0);
    const cardHeightRef = React.useRef(0);
    const layoutRef = React.useRef<ScrubLayout | null>(null);
    const bandRef = React.useRef<ScrubBand | null>(null);
    const railTopRef = React.useRef(0);
    const enabledRef = React.useRef(false);
    /** The overlay's place in the window, or `null` until it has been measured; see `onEdgeTouch`. */
    const rootRef = React.useRef<View>(null);
    const rootWindowRef = React.useRef<{ x: number; y: number } | null>(null);
    /** Where the finger came in from the edge, and what that touch turned out to be. */
    const edgeStartRef = React.useRef<{ x: number; y: number } | null>(null);
    const edgeIntentRef = React.useRef<'unknown' | 'reveal' | 'scroll'>('unknown');
    const selectedRef = React.useRef<number | null>(null);
    const visibleRef = React.useRef(false);
    const itemsRef = React.useRef(props.userMessages);
    const activeIndexRef = React.useRef(0);
    const anchorIndexRef = React.useRef<number | null>(null);
    /** Whether a finger is on the rail right now: the rail only ever fades out with nobody touching it. */
    const fingerDownRef = React.useRef(false);
    /** A jump the list has yet to answer — paging older messages in, say. The rail waits for it. */
    const locatingRef = React.useRef(false);
    /** The backstop on that wait; see `LOCATE_HOLD_MAX_MS`. */
    const locateCapRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const rootWidthRef = React.useRef(0);
    /** Set when the finger wanders into the left of the screen: this touch picks nothing from then on. */
    const abandonedRef = React.useRef(false);
    /** The landmark the drag started on; only moving off it means the reader picked something. */
    const startIndexRef = React.useRef<number | null>(null);
    const sweptRef = React.useRef(false);

    const items = props.userMessages;
    const total = items.length;

    // Where the rail rests: the landmark the reader is on, or the newest one when the list has not
    // named it yet — the rail is opened from the bottom of the conversation far more often than not.
    const activeIndex = React.useMemo(() => {
        const index = items.findIndex((item) => item.message.id === props.activeMessageId);
        return index >= 0 ? index : Math.max(0, total - 1);
    }, [items, props.activeMessageId, total]);

    const band: ScrubBand | null = React.useMemo(() => {
        if (rootHeight <= 0) return null;
        const top = rootHeight * BAND_TOP_RATIO;
        const height = rootHeight * (1 - BAND_TOP_RATIO - BAND_BOTTOM_RATIO);
        return { top, height: Math.max(MIN_BAND_HEIGHT, height) };
    }, [rootHeight]);

    const layout = React.useMemo(
        () => (band ? scrubLayout(band, TOUCH_SLOT_HEIGHT, total) : null),
        [band, total]
    );

    const railTop = layout ? railTopForWindow(band!, TOUCH_SLOT_HEIGHT, layout.slots) : 0;

    const enabled = total >= MIN_ITEMS && layout !== null && !keyboardVisible;

    // Every gesture callback reads through these, so no handler has to be rebuilt as the state moves.
    React.useEffect(() => {
        layoutRef.current = layout;
        bandRef.current = band;
        railTopRef.current = railTop;
        enabledRef.current = enabled;
        itemsRef.current = items;
        activeIndexRef.current = activeIndex;
        anchorIndexRef.current = anchorIndex;
        visibleRef.current = visible;
    });

    React.useEffect(() => () => {
        if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
        if (locateCapRef.current !== null) clearTimeout(locateCapRef.current);
    }, []);

    /** Moves the highlight and the preview to a landmark sitting at `fingerY` on the rail. */
    const highlight = React.useCallback((index: number, fingerY: number) => {
        const currentLayout = layoutRef.current;
        if (!currentLayout) return;
        fingerYRef.current = fingerY;
        cardY.setValue(cardTopAtOffset(currentLayout, cardHeightRef.current, fingerY));
        if (selectedRef.current === index) return;
        selectedRef.current = index;
        setSelectedIndex(index);
        setCardIndex(index);
        if (tickGateRef.current(Date.now())) hapticsLight();
        cardFade.stopAnimation();
        Animated.timing(cardFade, {
            toValue: 1,
            duration: CARD_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
        }).start();
    }, [cardFade, cardY]);

    /** The landmark the drawn window is anchored on: the finger's pick while pinned, else the reader. */
    const resolveAnchor = React.useCallback(
        () => anchorIndexRef.current ?? activeIndexRef.current,
        []
    );

    /**
     * Picks the landmark the finger at `y` is on, and notes whether it moved off the mark it started on.
     *
     * `y` arrives relative to the touch zone — the view the gesture is attached to — and the zone is the
     * rail's own rectangle, so the rail's geometry (which is laid out against the overlay) needs the
     * zone's top added before anything is compared against it. Without it the whole mapping sits that
     * far too high, and the mark picked is not the mark under the finger.
     */
    const placeFinger = React.useCallback((y: number) => {
        const currentLayout = layoutRef.current;
        if (!currentLayout) return;
        const overlayY = y + railTopRef.current;
        const count = itemsRef.current.length;
        const windowStart = windowStartFor(resolveAnchor(), currentLayout.slots, count);
        const next = indexAtRail(currentLayout, count, railTopRef.current, overlayY, selectedRef.current ?? -1, windowStart);
        if (next !== selectedRef.current) {
            if (startIndexRef.current === null) startIndexRef.current = next;
            else if (next !== startIndexRef.current) sweptRef.current = true;
        }
        highlight(next, overlayY);
    }, [highlight, resolveAnchor]);

    const fadeOut = React.useCallback(() => {
        Animated.timing(revealAnim, {
            toValue: 0,
            duration: HIDE_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
        }).start(({ finished }) => {
            // Interrupted by a new touch: that touch has already taken the rail over.
            if (!finished) return;
            visibleRef.current = false;
            setVisible(false);
            selectedRef.current = null;
            setSelectedIndex(null);
            setCardIndex(null);
            // The next summon centres on wherever the reader is by then.
            setAnchorIndex(null);
        });
    }, [revealAnim]);

    const scheduleHide = React.useCallback((delay: number) => {
        if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
        // A jump is still being resolved: it owns the rail, and hands it back when it is done. Fading out
        // here would take the landmark the reader picked off the screen while the list is still working
        // its way to it, with the rail the only thing saying what is being looked for.
        if (locatingRef.current) return;
        hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            // A finger landed while the clock ran: the rail is in use, and its own lift will re-arm this.
            if (fingerDownRef.current) return;
            fadeOut();
        }, delay);
    }, [fadeOut]);

    const cancelHide = React.useCallback(() => {
        if (hideTimerRef.current !== null) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    /** Brings the rail up (or resumes it mid-fade) — display only, no landmark picked. */
    const showRail = React.useCallback(() => {
        cancelHide();
        visibleRef.current = true;
        setVisible(true);
        revealAnim.stopAnimation();
        Animated.timing(revealAnim, {
            toValue: 1,
            duration: REVEAL_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [cancelHide, revealAnim]);

    const fadeCardOut = React.useCallback(() => {
        cardFade.stopAnimation();
        Animated.timing(cardFade, {
            toValue: 0,
            duration: CARD_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: false,
        }).start();
    }, [cardFade]);

    /**
     * Hears the summoning swipe from outside the rail.
     *
     * While the rail is hidden its touch zone takes no touches — that is what lets the list keep
     * scrolling under the right edge — so the swipe has to be heard by a listener on an ancestor of the
     * list, which observes touches the list is handling without taking any of them from it. The
     * coordinates arrive in window space, the only space that listener knows about.
     *
     * The reading itself (`readEdgeSwipe`) is the same one the rail's own gesture used to do: a touch
     * that commits sideways before it commits up or down is a summon, and anything else is a scroll that
     * belongs to the list. Only the very start of the touch is worth this much attention — the moment the
     * reading is decided, the rest of the touch is none of our business.
     */
    const onEdgeTouch = React.useCallback((phase: ConversationMinimapEdgeTouchPhase, pageX: number, pageY: number) => {
        if (phase === 'start') {
            // A finger still on the screen keeps the reading: a second one landing mid-scroll, or on the
            // rail, does not take it over.
            if (edgeStartRef.current !== null) return;
            edgeIntentRef.current = 'unknown';
            if (!enabledRef.current || visibleRef.current) return;
            const currentBand = bandRef.current;
            if (!currentBand) return;
            const origin = rootWindowRef.current;
            // In from the edge, above the input row: a thumb anywhere else is scrolling the list.
            if (pageX < (origin?.x ?? 0) + rootWidthRef.current - ZONE_OFFSET) return;
            // The input row's corner is not part of the summoning edge, but until the overlay has been
            // measured its place in the window is a guess — take the touch at face value instead.
            if (origin && pageY - origin.y > currentBand.top + currentBand.height) return;
            edgeStartRef.current = { x: pageX, y: pageY };
            return;
        }

        if (phase === 'end') {
            const summoned = edgeIntentRef.current === 'reveal';
            edgeStartRef.current = null;
            edgeIntentRef.current = 'unknown';
            // The clock starts when the finger leaves, and only then: a finger resting on the edge
            // keeps the rail up for as long as it stays there.
            if (summoned && visibleRef.current) scheduleHide(LINGER_MS);
            return;
        }

        const start = edgeStartRef.current;
        if (!start || edgeIntentRef.current !== 'unknown') return;
        const reading = readEdgeSwipe(pageX - start.x, pageY - start.y);
        if (reading === 'pending') return;
        // Decided once per touch: a scroll stays a scroll even if the finger turns sideways later.
        edgeIntentRef.current = reading;
        if (reading === 'reveal') {
            // Display only: whatever this same finger does next, it is not aiming yet.
            // The one moment worth feeling: the rail has appeared under the thumb.
            hapticsHeavy();
            showRail();
        }
    }, [scheduleHide, showRail]);

    React.useEffect(() => {
        const register = props.onRegisterMinimapEdgeTouch;
        if (!register) return;
        register(onEdgeTouch);
        return () => register(null);
    }, [onEdgeTouch, props.onRegisterMinimapEdgeTouch]);

    // Typing is the one thing the rail must never get between the thumb and the list for: it goes away
    // when the keyboard arrives, and cannot be summoned again until it has gone.
    React.useEffect(() => {
        if (!keyboardVisible) return;
        cancelHide();
        if (visibleRef.current) fadeOut();
    }, [cancelHide, fadeOut, keyboardVisible]);

    const jump = React.useCallback(() => {
        const item = itemsRef.current[selectedRef.current ?? -1];
        if (!item) return;
        hapticsLight();
        const settled = props.onJumpToMessage(item.message);
        // A landmark already in the list answers on the spot and the usual clock runs. One further back
        // answers only once the list has paged its way to it: until then the rail stays up, on the mark
        // the reader picked, and the usual clock starts when the answer arrives.
        if (!(settled instanceof Promise)) return;
        locatingRef.current = true;
        cancelHide();
        const release = () => {
            if (locateCapRef.current !== null) {
                clearTimeout(locateCapRef.current);
                locateCapRef.current = null;
            }
            if (!locatingRef.current) return;
            locatingRef.current = false;
            if (visibleRef.current && !fingerDownRef.current) scheduleHide(LINGER_MS);
        };
        locateCapRef.current = setTimeout(release, LOCATE_HOLD_MAX_MS);
        settled.then(release, release);
    }, [props.onJumpToMessage, cancelHide, scheduleHide]);

    const scrub = React.useMemo(() => Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        // Deliberately loose activation: this only has to notice that the finger moved, and the gate
        // below decides whether that movement picks anything.
        .minDistance(MIN_DRAG)
        // The finger starts outside the zone and only ever moves further away; cancelling would end it.
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        // The zone is a touch target only while the rail is drawn, so a touch that reaches this
        // handler is a finger on the rail: it aims. Summoning is heard from outside instead.
        .onBegin((event) => {
            fingerDownRef.current = true;
            cancelHide();
            startIndexRef.current = null;
            sweptRef.current = false;
            abandonedRef.current = false;
            // The touch picks the mark under the finger at once, and only a move off that first mark
            // turns the lift into a jump.
            if (anchorIndexRef.current === null) setAnchorIndex(activeIndexRef.current);
            placeFinger(event.y);
        })
        .onUpdate((event) => {
            if (abandonedRef.current) return;
            // The zone's left edge sits ZONE_OFFSET from the right edge of the screen, and `x` is
            // measured from that edge, so the finger's place on the overlay is one plus the other.
            const overlayX = event.x + rootWidthRef.current - ZONE_OFFSET;
            if (overlayX <= rootWidthRef.current * CANCEL_LEFT_RATIO) {
                abandonedRef.current = true;
                selectedRef.current = null;
                setSelectedIndex(null);
                fadeCardOut();
                return;
            }
            placeFinger(event.y);
        })
        // Only a drag that actually moved picks a landmark: touching the rail and letting go is not a
        // choice, which is what keeps a summon-then-aim flow from jumping on its own.
        .onEnd(() => {
            // Nothing is picked by a touch that walked off to the left of the screen, however far along
            // the rail it got before it did.
            if (!sweptRef.current || abandonedRef.current) return;
            jump();
        })
        .onFinalize(() => {
            fingerDownRef.current = false;
            // A drag that picked something keeps its highlight — the map is showing where the jump
            // landed. Clearing it here would snap the rail back to where it stood before the touch.
            if (!sweptRef.current) {
                selectedRef.current = null;
                setSelectedIndex(null);
            }
            fadeCardOut();
            // The clock starts when the finger leaves, and only then — a finger resting on the rail
            // keeps it up indefinitely, which is what makes "summon, then take your time" work.
            if (visibleRef.current) scheduleHide(LINGER_MS);
            startIndexRef.current = null;
            sweptRef.current = false;
            abandonedRef.current = false;
        })
    , [
        enabled,
        cancelHide,
        fadeCardOut,
        jump,
        placeFinger,
        scheduleHide,
    ]);

    const onCardLayout = React.useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
        cardHeightRef.current = event.nativeEvent.layout.height;
        const currentLayout = layoutRef.current;
        if (currentLayout && selectedRef.current !== null) {
            cardY.setValue(cardTopAtOffset(currentLayout, cardHeightRef.current, fingerYRef.current));
        }
    }, [cardY]);

    // Screen readers get the same walk one landmark at a time, since a swipe along a rail is not
    // something VoiceOver or TalkBack can perform.
    const onAccessibilityAction = React.useCallback((event: { nativeEvent: { actionName: string } }) => {
        const currentLayout = layoutRef.current;
        if (!currentLayout) return;
        const from = selectedRef.current ?? activeIndexRef.current;
        const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        const count = itemsRef.current.length;
        const next = clamp(from + step, 0, Math.max(0, count - 1));
        if (anchorIndexRef.current === null) setAnchorIndex(activeIndexRef.current);
        const windowStart = windowStartFor(resolveAnchor(), currentLayout.slots, count);
        showRail();
        highlight(next, railTopRef.current + (next - windowStart + 0.5) * TOUCH_SLOT_HEIGHT);
        jump();
        scheduleHide(LINGER_MS);
    }, [highlight, jump, resolveAnchor, scheduleHide, showRail]);

    const anchor = anchorIndex === null ? activeIndex : clamp(anchorIndex, 0, Math.max(0, total - 1));
    const selected = selectedIndex === null ? anchor : clamp(selectedIndex, 0, Math.max(0, total - 1));
    // Anchored on the reader's landmark (or on where a touch pinned it), not on the finger: the marks
    // must stay put while a finger slides over them, and this is the window `placeFinger` maps against.
    const windowStart = layout ? windowStartFor(anchor, layout.slots, total) : 0;
    const cardItem = items[cardIndex ?? -1];

    return (
        <View
            ref={rootRef}
            pointerEvents="box-none"
            onLayout={(event) => {
                setRootHeight(event.nativeEvent.layout.height);
                rootWidthRef.current = event.nativeEvent.layout.width;
                // The edge listener reports window coordinates, and only the overlay itself knows where
                // the overlay sits in the window.
                rootRef.current?.measureInWindow((x, y) => {
                    rootWindowRef.current = { x, y };
                });
            }}
            style={styles.root}
        >
            {band && layout && (
                <>
                    {enabled && (
                        <GestureDetector gesture={scrub}>
                            <View
                                // Hidden, the right edge is the list's to scroll; see `onEdgeTouch`.
                                pointerEvents={visible ? 'auto' : 'none'}
                                accessible
                                accessibilityRole="adjustable"
                                accessibilityLabel={t('session.minimapNavigator')}
                                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                                onAccessibilityAction={onAccessibilityAction}
                                style={[
                                    styles.zone,
                                    // Shown, the zone is the marks' own rectangle; hidden it takes no touches,
                                    // and what is left is the frame a screen reader outlines.
                                    visible
                                        ? { top: railTop, height: layout.slots * TOUCH_SLOT_HEIGHT }
                                        : { top: 0, height: band.top + band.height },
                                ]}
                            />
                        </GestureDetector>
                    )}

                    {visible && (
                        <Animated.View
                            pointerEvents="none"
                            style={[
                                styles.rail,
                                {
                                    top: railTop,
                                    height: layout.slots * TOUCH_SLOT_HEIGHT,
                                    opacity: revealAnim,
                                    transform: [{
                                        translateX: revealAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [SLIDE_IN, 0],
                                        }),
                                    }],
                                },
                            ]}
                        >
                            {items.slice(windowStart, windowStart + layout.slots).map((item, slotIndex) => {
                                const index = windowStart + slotIndex;
                                const isSelected = index === selected;
                                return (
                                    <View key={item.message.id} style={styles.slot}>
                                        <View style={{
                                            width: MARKER_WIDTH * getHoverScale(Math.abs(selected - index)),
                                            height: MARKER_HEIGHT,
                                            borderRadius: 4,
                                            backgroundColor: isSelected ? theme.colors.text : theme.colors.textSecondary,
                                            opacity: isSelected ? 0.95 : 0.45,
                                        }} />
                                    </View>
                                );
                            })}
                        </Animated.View>
                    )}

                    {visible && cardItem && (
                        <Animated.View
                            pointerEvents="none"
                            onLayout={onCardLayout}
                            style={[styles.card, { opacity: cardFade, transform: [{ translateY: cardY }] }]}
                        >
                            <MinimapPreviewCard message={cardItem.message} />
                        </Animated.View>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1001,
    },
    zone: {
        position: 'absolute',
        right: 0,
        width: ZONE_OFFSET,
    },
    rail: {
        position: 'absolute',
        right: RAIL_INSET,
        width: RAIL_WIDTH,
        alignItems: 'flex-end',
    },
    slot: {
        width: RAIL_WIDTH,
        height: TOUCH_SLOT_HEIGHT,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    card: {
        position: 'absolute',
        top: 0,
        right: RAIL_INSET + RAIL_WIDTH + CARD_GAP,
        width: PREVIEW_WIDTH,
    },
});

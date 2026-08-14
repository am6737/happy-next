import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/text';
import { getTtsQueueSnapshot, removeQueuedTts, skipCurrentTts, subscribeTtsQueue } from '@/tts/messageTtsQueue';
import type { TtsPhase, TtsQueueItem } from '@/tts/messageTtsQueue';
import { useSession } from '@/sync/storage';
import { getSessionName } from '@/utils/sessionUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';

const PILL_SIZE = 40;
// How far the docked half-pill hides beyond the screen edge (drags show the
// whole circle; docking tucks the flat side away to keep the footprint slim).
const PILL_TUCK = 6;
const PANEL_MAX_WIDTH = 300;
const EDGE_MARGIN = 8;
const AUTO_COLLAPSE_MS = 5000;
// Plain ease-out — snapping must not bounce.
const TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

type Side = 'left' | 'right';

// Dragged position/side survive hide/remount for the rest of the app run.
let savedY: number | null = null;
let savedSide: Side = 'right';
function saveY(v: number) {
    savedY = v;
}

function clamp(v: number, min: number, max: number) {
    'worklet';
    return Math.min(max, Math.max(min, v));
}

/**
 * WeChat-style floating "read aloud" widget, mounted once at the app root and
 * visible on every screen while the global TTS queue is active. Collapsed: a
 * small pill; expanded: the queue panel (draggable by its title) — tap a row to
 * jump to its session, ✕ on the current row stops it (queue continues), ✕ on a
 * queued row removes it. Both states drag freely and snap to the nearer edge
 * on release; mirrored styling when docked left.
 */
export function TtsFloatingPlayer() {
    const snap = React.useSyncExternalStore(subscribeTtsQueue, getTtsQueueSnapshot, getTtsQueueSnapshot);
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { height: winH, width: winW } = useWindowDimensions();
    const navigateToSession = useNavigateToSession();

    const minY = insets.top + EDGE_MARGIN;
    const maxY = winH - insets.bottom - PILL_SIZE - EDGE_MARGIN;
    const panelW = Math.min(PANEL_MAX_WIDTH, winW - EDGE_MARGIN * 2);

    const [side, setSide] = React.useState<Side>(savedSide);
    const applySide = React.useCallback((s: Side) => {
        savedSide = s;
        setSide(s);
    }, []);

    const y = useSharedValue(clamp(savedY ?? insets.top + 120, minY, maxY));
    const x = useSharedValue(savedSide === 'left' ? -PILL_TUCK : winW - PILL_SIZE + PILL_TUCK);
    const dragStartX = useSharedValue(0);
    const dragStartY = useSharedValue(0);
    const panelH = useSharedValue(0);

    const [expanded, setExpanded] = React.useState(false);
    // The docked pill is a half-circle flush with the edge; while dragging (and
    // until the snap animation lands) it shows as a full circle.
    const [pillRound, setPillRound] = React.useState(false);
    const settlePill = React.useCallback(() => setPillRound(false), []);
    const collapseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // On web a completed drag still delivers a click to whatever is under the
    // pointer (RNGH doesn't cancel synthetic clicks there, unlike the native
    // responder cancellation) — presses check this flag to tell them apart.
    const draggingRef = React.useRef(false);
    const beginDrag = React.useCallback(() => {
        draggingRef.current = true;
        setPillRound(true);
    }, []);
    const endDrag = React.useCallback(() => {
        setTimeout(() => { draggingRef.current = false; }, 150);
    }, []);

    const collapse = React.useCallback(() => {
        if (collapseTimer.current) {
            clearTimeout(collapseTimer.current);
            collapseTimer.current = null;
        }
        setExpanded(false);
    }, []);

    const armCollapseTimer = React.useCallback(() => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        collapseTimer.current = setTimeout(() => {
            collapseTimer.current = null;
            setExpanded(false);
        }, AUTO_COLLAPSE_MS);
    }, []);

    const expand = React.useCallback(() => {
        if (draggingRef.current) return;
        setExpanded(true);
        armCollapseTimer();
    }, [armCollapseTimer]);

    const handleCollapsePress = React.useCallback(() => {
        if (draggingRef.current) return;
        collapse();
    }, [collapse]);

    const handleNavigate = React.useCallback((sessionId: string) => {
        collapse();
        navigateToSession(sessionId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapse]);

    // Gestures are recreated per render so the worklets capture fresh bounds.
    // Two instances of the same drag (RNGH forbids sharing one across
    // detectors): both move the shared x/y, so pill and panel stay in sync.
    const makePan = (width: number, dockLeftX: number, dockRightX: number, onLive?: () => void) => Gesture.Pan()
        .minDistance(6) // plain taps still reach the inner Pressables
        .maxPointers(1)
        .onStart(() => {
            dragStartX.value = x.value;
            dragStartY.value = y.value;
            runOnJS(beginDrag)();
        })
        .onUpdate((e) => {
            // While dragging the widget stays fully on screen (the pill shows
            // as a whole circle); the tucked position is only for docking.
            x.value = clamp(dragStartX.value + e.translationX, 0, winW - width);
            y.value = clamp(dragStartY.value + e.translationY, minY, maxY);
            if (onLive) runOnJS(onLive)();
        })
        .onFinalize(() => {
            // Snap to whichever edge the widget's center is closer to.
            const s: Side = x.value + width / 2 < winW / 2 ? 'left' : 'right';
            x.value = withTiming(s === 'left' ? dockLeftX : dockRightX, TIMING, (finished) => {
                if (finished) runOnJS(settlePill)();
            });
            runOnJS(saveY)(y.value);
            runOnJS(applySide)(s);
            runOnJS(endDrag)();
            if (onLive) runOnJS(onLive)();
        });

    const pillPan = makePan(PILL_SIZE, -PILL_TUCK, winW - PILL_SIZE + PILL_TUCK);
    // Keep the auto-collapse timer from firing mid-drag.
    const headerPan = makePan(panelW, EDGE_MARGIN, winW - panelW - EDGE_MARGIN, armCollapseTimer);

    const pillAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: x.value }, { translateY: y.value }],
    }));

    // The panel shares x/y with the pill but is taller — pull it up so it never
    // runs past the bottom edge (height known only after layout).
    const panelAnimatedStyle = useAnimatedStyle(() => {
        const maxTop = winH - insets.bottom - EDGE_MARGIN - panelH.value;
        return {
            transform: [
                { translateX: x.value },
                { translateY: clamp(y.value, minY, Math.max(minY, maxTop)) },
            ],
        };
    });

    const onPanelLayout = React.useCallback((e: LayoutChangeEvent) => {
        panelH.value = e.nativeEvent.layout.height;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-dock when the widget's width changes (expand/collapse) or the window
    // resizes/rotates. Animating (not jumping) keeps this from cutting off the
    // snap animation a moment after applySide() re-renders us.
    React.useEffect(() => {
        y.value = clamp(y.value, minY, maxY);
        const target = expanded
            ? (side === 'left' ? EDGE_MARGIN : winW - panelW - EDGE_MARGIN)
            : (side === 'left' ? -PILL_TUCK : winW - PILL_SIZE + PILL_TUCK);
        x.value = withTiming(target, TIMING, (finished) => {
            'worklet';
            if (finished) runOnJS(settlePill)();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minY, maxY, winW, expanded, side, panelW]);

    const active = snap.current !== null;
    React.useEffect(() => {
        if (!active) collapse();
    }, [active, collapse]);
    React.useEffect(() => () => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
    }, []);

    if (!active) return null;

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            {expanded ? (
                <Animated.View
                    style={[styles.panel, { width: panelW }, panelAnimatedStyle]}
                    onLayout={onPanelLayout}
                    // Any interaction inside the panel resets the auto-collapse
                    // countdown, without claiming the touch.
                    onStartShouldSetResponderCapture={() => {
                        armCollapseTimer();
                        return false;
                    }}
                >
                    <View style={styles.panelHeader}>
                        <GestureDetector gesture={headerPan}>
                            <View style={styles.panelTitleArea}>
                                <Text style={styles.panelTitle}>{t('tts.queueTitle')}</Text>
                            </View>
                        </GestureDetector>
                        <Pressable
                            onPress={handleCollapsePress}
                            hitSlop={8}
                            style={styles.panelCollapse}
                            accessibilityLabel={t('common.cancel')}
                        >
                            <Ionicons
                                name={side === 'left' ? 'chevron-back' : 'chevron-forward'}
                                size={18}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>
                    <ScrollView style={styles.panelList} bounces={false}>
                        <QueueRow
                            item={snap.current!}
                            isCurrent
                            phase={snap.phase}
                            onNavigate={handleNavigate}
                            onInteract={armCollapseTimer}
                        />
                        {snap.queue.map((q, i) => (
                            <QueueRow
                                key={q.messageId}
                                item={q}
                                index={i + 1}
                                onNavigate={handleNavigate}
                                onInteract={armCollapseTimer}
                            />
                        ))}
                    </ScrollView>
                </Animated.View>
            ) : (
                <GestureDetector gesture={pillPan}>
                    <Animated.View
                        style={[
                            styles.pill,
                            pillRound ? styles.pillCircle : (side === 'left' ? styles.pillLeft : styles.pillRight),
                            pillAnimatedStyle,
                        ]}
                    >
                        <Pressable style={styles.pillPress} onPress={expand} accessibilityLabel={t('tts.showQueue')}>
                            {snap.phase === 'loading' ? (
                                // "small" is ~20px — scale down to sit right in the pill.
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} style={{ transform: [{ scale: 0.8 }] }} />
                            ) : (
                                <AnimatedSpeaker
                                    size={20}
                                    color={theme.colors.textSecondary}
                                    animate={snap.phase === 'playing'}
                                    mirrored={side === 'left'}
                                />
                            )}
                            {snap.queue.length > 0 && (
                                <View style={[styles.badge, side === 'left' ? styles.badgeLeftDock : styles.badgeRightDock]}>
                                    <Text style={styles.badgeText}>{snap.queue.length}</Text>
                                </View>
                            )}
                        </Pressable>
                    </Animated.View>
                </GestureDetector>
            )}
        </View>
    );
}

// Speaker "wave" animation, drawn as our own SVG: the speaker body and each
// wave are separate paths, and frames only flip wave opacity — nothing is ever
// laid out again, so the body cannot shift. (Icon-font approaches all failed:
// each volume-* glyph centers its ink differently, so the body drifted.)
// Rounded-corner body (user-picked variant C): every corner is curved, the
// speaker-mouth tips most of all, while the silhouette stays slim.
const SPEAKER_BODY = 'M3.5 10.2 Q3.5 9 4.7 9 L6.7 9 Q7.5 9 8.11 8.49 L11.43 5.7 Q12.5 4.8 12.5 6.2 L12.5 17.8 Q12.5 19.2 11.43 18.3 L8.11 15.51 Q7.5 15 6.7 15 L4.7 15 Q3.5 15 3.5 13.8 Z';
const SPEAKER_WAVES = [
    'M15 9.6 A4 4 0 0 1 15 14.4',
    'M17.2 7.6 A6.8 6.8 0 0 1 17.2 16.4',
    'M19.4 5.7 A9.6 9.6 0 0 1 19.4 18.3',
];

function AnimatedSpeaker(props: { size: number; color: string; animate: boolean; mirrored?: boolean }) {
    const [frame, setFrame] = React.useState(SPEAKER_WAVES.length - 1);
    React.useEffect(() => {
        if (!props.animate) {
            setFrame(SPEAKER_WAVES.length - 1);
            return;
        }
        const id = setInterval(() => {
            setFrame((f) => (f + 1) % SPEAKER_WAVES.length);
        }, 350);
        return () => clearInterval(id);
    }, [props.animate]);
    return (
        <Svg
            width={props.size}
            height={props.size}
            viewBox="0 0 24 24"
            style={props.mirrored ? { transform: [{ scaleX: -1 }] } : undefined}
        >
            <Path d={SPEAKER_BODY} fill={props.color} />
            {SPEAKER_WAVES.map((d, i) => (
                <Path
                    key={d}
                    d={d}
                    stroke={props.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    fill="none"
                    opacity={i <= frame ? 1 : 0}
                />
            ))}
        </Svg>
    );
}

function QueueRow(props: {
    item: TtsQueueItem;
    isCurrent?: boolean;
    phase?: TtsPhase;
    index?: number;
    onNavigate: (sessionId: string) => void;
    onInteract: () => void;
}) {
    const { theme } = useUnistyles();
    const session = useSession(props.item.sessionId);
    const name = session ? getSessionName(session) : '';
    const preview = props.item.text.replace(/\s+/g, ' ').trim();
    return (
        <View style={[styles.row, props.isCurrent && styles.rowCurrent]}>
            <View style={styles.rowIcon}>
                {props.isCurrent ? (
                    props.phase === 'loading' ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : (
                        <AnimatedSpeaker size={20} color={theme.colors.text} animate={props.phase === 'playing'} />
                    )
                ) : (
                    <Text style={styles.rowIndex}>{props.index}</Text>
                )}
            </View>
            <Pressable style={styles.rowBody} onPress={() => props.onNavigate(props.item.sessionId)}>
                {name ? <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text> : null}
                <Text style={styles.rowPreview} numberOfLines={1}>{preview}</Text>
            </Pressable>
            <Pressable
                style={styles.rowClose}
                hitSlop={8}
                accessibilityLabel={props.isCurrent ? t('tts.stopCurrent') : t('tts.removeFromQueue')}
                onPress={() => {
                    props.onInteract();
                    if (props.isCurrent) skipCurrentTts();
                    else removeQueuedTts(props.item.messageId);
                }}
            >
                <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9998,
        // Clips the tucked part of the docked pill (also prevents a stray
        // horizontal scrollbar on web).
        overflow: 'hidden',
    },
    pill: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: PILL_SIZE,
        height: PILL_SIZE,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 6,
    },
    // While dragging: a full, free-floating circle.
    pillCircle: {
        borderRadius: PILL_SIZE / 2,
    },
    // Docked: half-circle, flat side toward the screen edge (the flat part is
    // tucked beyond it).
    pillRight: {
        borderTopLeftRadius: PILL_SIZE / 2,
        borderBottomLeftRadius: PILL_SIZE / 2,
        borderRightWidth: 0,
    },
    pillLeft: {
        borderTopRightRadius: PILL_SIZE / 2,
        borderBottomRightRadius: PILL_SIZE / 2,
        borderLeftWidth: 0,
    },
    pillPress: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        position: 'absolute',
        top: 0,
        minWidth: 14,
        height: 14,
        borderRadius: 7,
        paddingHorizontal: 3,
        backgroundColor: '#FF3B30',
        alignItems: 'center',
        justifyContent: 'center',
    },
    // The badge sits on the inner corner (away from the docked edge).
    badgeRightDock: {
        left: 0,
    },
    badgeLeftDock: {
        right: 0,
    },
    badgeText: {
        color: '#ffffff',
        fontSize: 9,
        fontWeight: '600',
    },
    panel: {
        position: 'absolute',
        top: 0,
        left: 0,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 10,
    },
    panelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    panelTitleArea: {
        flex: 1,
        paddingLeft: 14,
        paddingVertical: 10,
    },
    panelTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    panelCollapse: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    panelList: {
        maxHeight: 320,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 10,
    },
    rowCurrent: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    rowIcon: {
        width: 24,
        alignItems: 'center',
        marginRight: 8,
    },
    rowIndex: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    rowBody: {
        flex: 1,
        marginRight: 8,
    },
    rowTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 2,
    },
    rowPreview: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    rowClose: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

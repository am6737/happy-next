import * as React from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { hapticsLight } from './haptics';

/**
 * A vertical list dragged into a new order by each row's handle, the same way on every platform:
 * the dragged row lifts and follows the finger or pointer while the others slide out of its way,
 * and it settles into the gap on release.
 *
 * The rows stay in normal layout, in the order that comes in through `items`; only while a drag is
 * on (until its drop is saved and laid out) is each one shifted from its own spot to the one its
 * place in the dragged order has. At rest nothing is shifted, so the list first shows exactly as laid
 * out — there is no frame waiting on the UI thread to learn where the rows go.
 */

type Positions = Record<string, number>;
type Heights = Record<string, number>;

const SETTLE_MS = 180;

function positionsOf(keys: readonly string[]): Positions {
    const positions: Positions = {};
    keys.forEach((key, index) => { positions[key] = index; });
    return positions;
}

function offsetOf(key: string, positions: Positions, heights: Heights): number {
    'worklet';
    const position = positions[key];
    let offset = 0;
    for (const other in positions) {
        if (positions[other] < position) offset += heights[other] ?? 0;
    }
    return offset;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

export function SortableList<T>(props: {
    items: readonly T[];
    keyOf: (item: T) => string;
    /** One row; place `handle` where the row is grabbed. `isLast` is by the laid-out order. */
    renderItem: (item: T, handle: React.ReactNode, dragging: boolean, isLast: boolean) => React.ReactNode;
    /** The whole list in its new order, once a drag settles somewhere else. */
    onReorder: (keys: string[]) => void;
    /** What the handle shows. */
    renderHandle: (dragging: boolean) => React.ReactNode;
}) {
    const { items, keyOf, renderItem, onReorder, renderHandle } = props;
    const keys = React.useMemo(() => items.map(keyOf), [items, keyOf]);
    const positions = useSharedValue<Positions>(positionsOf(keys));
    const heights = useSharedValue<Heights>({});
    const activeKey = useSharedValue<string | null>(null);
    const [measured, setMeasured] = React.useState<Heights>({});
    const [draggingKey, setDraggingKey] = React.useState<string | null>(null);
    // A dropped order waiting for `items` to come back in it before the rows stop being shifted.
    const pendingOrderRef = React.useRef<string[] | null>(null);
    const keysRef = React.useRef(keys);
    keysRef.current = keys;

    React.useEffect(() => {
        positions.value = positionsOf(keys);
        if (pendingOrderRef.current && sameOrder(pendingOrderRef.current, keys)) {
            pendingOrderRef.current = null;
            activeKey.value = null;
        }
    }, [keys, positions, activeKey]);

    // The heights are gathered in React state and handed to the UI thread whole: a shared value read
    // back on the JS thread on native can be a write behind, so merging into it there drops rows.
    const onRowLayout = React.useCallback((key: string, height: number) => {
        setMeasured(previous => previous[key] === height ? previous : { ...previous, [key]: height });
    }, []);
    React.useEffect(() => {
        heights.value = measured;
    }, [measured, heights]);

    const onDragStart = React.useCallback((key: string) => {
        setDraggingKey(key);
        if (Platform.OS !== 'web') hapticsLight();
    }, []);

    const onDrop = React.useCallback((order: string[]) => {
        setDraggingKey(null);
        if (sameOrder(order, keysRef.current)) return;
        pendingOrderRef.current = order;
        onReorder(order);
    }, [onReorder]);

    // The dropped row has reached its gap: stop shifting, unless the rows are not laid out in the new
    // order yet — then the effect above stops it once they are.
    const onSettled = React.useCallback(() => {
        if (pendingOrderRef.current && !sameOrder(pendingOrderRef.current, keysRef.current)) return;
        pendingOrderRef.current = null;
        activeKey.value = null;
    }, [activeKey]);

    let naturalTop = 0;
    return (
        <View>
            {items.map((item, index) => {
                const key = keyOf(item);
                const dragging = draggingKey === key;
                const top = naturalTop;
                naturalTop += measured[key] ?? 0;
                return (
                    <SortableRow
                        key={key}
                        id={key}
                        naturalTop={top}
                        positions={positions}
                        heights={heights}
                        activeKey={activeKey}
                        onLayout={onRowLayout}
                        onDragStart={onDragStart}
                        onDrop={onDrop}
                        onSettled={onSettled}
                        renderContent={(handle) => renderItem(item, handle, dragging, index === items.length - 1)}
                        handleContent={renderHandle(dragging)}
                    />
                );
            })}
        </View>
    );
}

function SortableRow(props: {
    id: string;
    /** Where normal layout puts the row. */
    naturalTop: number;
    positions: SharedValue<Positions>;
    heights: SharedValue<Heights>;
    activeKey: SharedValue<string | null>;
    onLayout: (key: string, height: number) => void;
    onDragStart: (key: string) => void;
    onDrop: (order: string[]) => void;
    onSettled: () => void;
    renderContent: (handle: React.ReactNode) => React.ReactNode;
    handleContent: React.ReactNode;
}) {
    const { id, naturalTop, positions, heights, activeKey, onLayout, onDragStart, onDrop, onSettled } = props;
    const { theme } = useUnistyles();
    // Where the row's place in the order puts it; it is shown there only while a drag is on.
    const top = useSharedValue(0);
    const startTop = useSharedValue(0);
    const lifted = useSharedValue(0);

    // Every row but the dragged one follows its place: sliding during a drag, jumping otherwise.
    useAnimatedReaction(
        () => offsetOf(id, positions.value, heights.value),
        (offset) => {
            if (activeKey.value === id) return;
            top.value = activeKey.value === null ? offset : withTiming(offset, { duration: SETTLE_MS });
        },
    );

    const pan = React.useMemo(() => Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
            activeKey.value = id;
            startTop.value = top.value;
            lifted.value = withTiming(1, { duration: 120 });
            runOnJS(onDragStart)(id);
        })
        .onUpdate((event) => {
            top.value = startTop.value + event.translationY;

            // The others in order, as if the dragged row were taken out; it takes the gap between them
            // whose top is closest to its own, so carrying it back to where it started puts it back.
            const others = Object.keys(positions.value)
                .filter(key => key !== id)
                .sort((a, b) => positions.value[a] - positions.value[b]);
            let target = 0;
            let closest = Infinity;
            let gapTop = 0;
            for (let index = 0; index <= others.length; index++) {
                const distance = Math.abs(top.value - gapTop);
                if (distance < closest) {
                    closest = distance;
                    target = index;
                }
                if (index < others.length) gapTop += heights.value[others[index]] ?? 0;
            }
            if (target === positions.value[id]) return;
            others.splice(target, 0, id);
            const next: Positions = {};
            others.forEach((key, index) => { next[key] = index; });
            positions.value = next;
        })
        .onFinalize(() => {
            if (activeKey.value !== id) return;
            const order = Object.keys(positions.value).sort((a, b) => positions.value[a] - positions.value[b]);
            lifted.value = withTiming(0, { duration: SETTLE_MS });
            top.value = withTiming(offsetOf(id, positions.value, heights.value), { duration: SETTLE_MS }, (finished) => {
                if (finished) runOnJS(onSettled)();
            });
            runOnJS(onDrop)(order);
        }), [id, positions, heights, activeKey, top, startTop, lifted, onDragStart, onDrop, onSettled]);

    const style = useAnimatedStyle(() => ({
        transform: [
            { translateY: activeKey.value === null ? 0 : top.value - naturalTop },
            { scale: 1 + lifted.value * 0.02 },
        ],
        zIndex: activeKey.value === id ? 10 : 0,
        shadowOpacity: lifted.value * 0.18,
        elevation: lifted.value * 8,
        borderRadius: lifted.value * 12,
    }), [naturalTop]);

    const handle = (
        <GestureDetector gesture={pan}>
            <View style={Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none' } as any) : undefined}>
                {props.handleContent}
            </View>
        </GestureDetector>
    );

    return (
        <Animated.View
            onLayout={(event: LayoutChangeEvent) => onLayout(id, event.nativeEvent.layout.height)}
            style={[
                {
                    backgroundColor: theme.colors.surface,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowRadius: 12,
                },
                style,
            ]}
        >
            {props.renderContent(handle)}
        </Animated.View>
    );
}

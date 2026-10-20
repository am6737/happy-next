import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { distanceFromEnd } from '@/components/chatListRowModel';

/**
 * Whether the native chat list should follow its newest message — decided by what the reader's
 * finger did, not by how far from the end the list happens to sit.
 *
 * LegendList's `maintainScrollAtEnd` alone follows whenever the list is within its threshold of the
 * end. That threshold has to be generous (rows measuring in as a chat opens push the end away), so
 * a reader who dragged up a few lines and let go was still "at the end" — and the next row to
 * measure pulled them back. Here:
 * - a drag or fling toward older messages lets go of the end at once, however short;
 * - coming to rest within `thresholdPx` of the end after moving toward it, or reaching the end by
 *   any means, takes hold again;
 * - content growing, the keyboard and programmatic scrolls never let go by themselves — only the
 *   reader does, or a caller through `stick` / `release`.
 *
 * `stuck` gates the list's own follow; the handlers must be wired to the list's scroll events.
 */
export function useChatStickToEnd(thresholdPx: number) {
    const [stuck, setStuck] = useState(true);
    const stuckRef = useRef(true);
    // The reader is moving the list: a finger on it, or the fling it left behind.
    const draggingRef = useRef(false);
    const flingingRef = useRef(false);
    // Which way the reader last moved the list (1 toward the end, -1 toward older messages).
    const directionRef = useRef<1 | -1 | 0>(0);
    const lastOffsetRef = useRef<number | null>(null);
    const lastDistanceRef = useRef(0);

    const update = useCallback((next: boolean) => {
        if (stuckRef.current === next) return;
        stuckRef.current = next;
        setStuck(next);
    }, []);

    const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offset = event.nativeEvent.contentOffset.y;
        const distance = distanceFromEnd(event.nativeEvent);
        const previousOffset = lastOffsetRef.current;
        lastOffsetRef.current = offset;
        lastDistanceRef.current = distance;
        if (distance <= 1) {
            update(true);
            return;
        }
        if ((!draggingRef.current && !flingingRef.current) || previousOffset === null) return;
        if (offset < previousOffset - 0.5) {
            directionRef.current = -1;
            update(false);
        } else if (offset > previousOffset + 0.5) {
            directionRef.current = 1;
        }
    }, [update]);

    // The reader stopped moving the list: back near the end, heading for it, takes hold again.
    const settle = useCallback(() => {
        if (draggingRef.current || flingingRef.current) return;
        if (directionRef.current === 1 && lastDistanceRef.current <= thresholdPx) update(true);
    }, [thresholdPx, update]);

    const onScrollBeginDrag = useCallback(() => {
        draggingRef.current = true;
        directionRef.current = 0;
    }, []);
    const onScrollEndDrag = useCallback(() => {
        draggingRef.current = false;
        settle();
    }, [settle]);
    const onMomentumScrollBegin = useCallback(() => { flingingRef.current = true; }, []);
    const onMomentumScrollEnd = useCallback(() => {
        flingingRef.current = false;
        settle();
    }, [settle]);

    const stick = useCallback(() => update(true), [update]);
    // Read in callbacks that run outside a render, where `stuck` may be a commit behind.
    const isStuck = useCallback(() => stuckRef.current, []);
    const release = useCallback(() => update(false), [update]);
    // Takes hold again only if the list rests within the threshold — for events (a prompt being
    // sent) that should follow a reader who drifted a little, but not one reading history.
    const stickIfNear = useCallback((): boolean => {
        if (lastDistanceRef.current > thresholdPx) return stuckRef.current;
        update(true);
        return true;
    }, [thresholdPx, update]);

    return { stuck, isStuck, onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, stick, release, stickIfNear };
}

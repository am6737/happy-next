import * as React from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { applyTerminalTabOrder, moveTerminalTab, terminalTabKey, type TerminalTab } from '@/terminal/terminalTabs';

/**
 * Dragging the tabs into a different order.
 *
 * Web only, and deliberately built on mouse events rather than a gesture
 * library. This is the one platform that can do it — a finger on a tab is
 * already the context menu — so the arbitration a gesture system would buy is
 * arbitration against nothing, and `react-native-gesture-handler` inside a
 * horizontal `ScrollView` is a well-known way to end up fighting the scroller.
 * A document-level `mousemove`/`mouseup` pair, which is also how the session
 * context menu dismisses itself, has no such problem.
 *
 * Where each tab sits is computed from the widths rather than read from the
 * layout. A tab's position is only ever reported when its *size* changes —
 * reordering the strip moves tabs without resizing them, so a remembered `x`
 * goes stale the first time anything is dragged, and the next drag places with
 * the geometry of the order before it. Widths do not have that problem.
 */

/** How far the pointer must travel before this is a drag and not a tap. */
const DRAG_THRESHOLD = 6;

export interface TerminalTabReorder {
    /** The tabs to draw: the dragged order while dragging, otherwise what came in. */
    renderTabs: readonly TerminalTab[];
    draggingKey: string | null;
    /** How far the dragged tab is being carried, in pixels. */
    dragOffsetX: number;
    /** Layout and drag handlers for one tab, keyed by `terminalTabKey`. */
    tabProps: (key: string) => Record<string, unknown>;
    onBarScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export function useTerminalTabReorder(input: {
    tabs: readonly TerminalTab[];
    enabled: boolean;
    /** The whole visible sequence, in its new order. */
    onReorder: (order: readonly string[]) => void;
    /** Space before the first tab and between tabs, from the strip's own styles. */
    leading: number;
    gap: number;
}): TerminalTabReorder {
    const { tabs, enabled, onReorder, leading, gap } = input;

    const widthsRef = React.useRef(new Map<string, number>());
    const scrollXRef = React.useRef(0);
    const [preview, setPreview] = React.useState<TerminalTab[] | null>(null);
    const [drag, setDrag] = React.useState<{ key: string; offsetX: number } | null>(null);

    // Read through refs inside the drag, which outlives the render that started
    // it — a list refreshed mid-drag must not have the handlers closed over the
    // array from before.
    const tabsRef = React.useRef(tabs);
    tabsRef.current = tabs;
    const onReorderRef = React.useRef(onReorder);
    onReorderRef.current = onReorder;

    const onBarScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollXRef.current = event.nativeEvent.contentOffset.x;
    }, []);

    const handleMouseDown = React.useCallback(
        (key: string, event: { button?: number; clientX?: number; ctrlKey?: boolean; preventDefault?: () => void }) => {
            // A ctrl+click is a right-click on macOS, and it arrives here as the
            // left button with the modifier set: without this, holding ctrl on a
            // tab and moving would drag it out from under the menu that the same
            // gesture is opening.
            if (!enabled || event.button !== 0 || event.ctrlKey || typeof document === 'undefined') {
                return;
            }
            const baseTabs = tabsRef.current;
            const order = baseTabs.map(terminalTabKey);
            const fromIndex = order.indexOf(key);
            if (fromIndex === -1 || event.clientX === undefined) {
                return;
            }

            const widths = new Map<string, number>();
            for (const tabKey of order) {
                const width = widthsRef.current.get(tabKey);
                if (width === undefined) {
                    // A tab that has never been measured cannot be placed
                    // reliably, and guessing would drop it where it was not asked
                    // for.
                    return;
                }
                widths.set(tabKey, width);
            }
            // Where a slot begins in any order, given the widths and the strip's
            // own spacing — the only two things that decide it.
            const slotX = (sequence: readonly string[], index: number) => {
                let x = leading;
                for (let i = 0; i < index; i += 1) {
                    x += (widths.get(sequence[i]!) ?? 0) + gap;
                }
                return x;
            };
            const centreAt = (sequence: readonly string[], index: number) =>
                slotX(sequence, index) + (widths.get(sequence[index]!) ?? 0) / 2;

            const startX = slotX(order, fromIndex);
            const startCentre = centreAt(order, fromIndex);
            const otherCentres = order
                .map((_, index) => index)
                .filter((index) => index !== fromIndex)
                .map((index) => centreAt(order, index));

            // Without this the drag selects the tab's label across the strip.
            event.preventDefault?.();

            const startClientX = event.clientX;
            const startScrollX = scrollXRef.current;
            let toIndex = fromIndex;
            let moved = false;

            // Everything is measured from where the drag began rather than from
            // the strip's own edge: a delta needs no absolute geometry, so the
            // strip never has to be measured against the window.
            const handleMove = (moveEvent: MouseEvent) => {
                const shift = (moveEvent.clientX - startClientX) + (scrollXRef.current - startScrollX);
                if (!moved) {
                    if (Math.abs(shift) < DRAG_THRESHOLD) {
                        return;
                    }
                    moved = true;
                }
                const centre = startCentre + shift;
                let next = 0;
                for (const other of otherCentres) {
                    if (centre > other) {
                        next += 1;
                    }
                }
                // Carried by the distance the pointer has travelled, less the
                // distance the dragged tab's slot has moved underneath it — so it
                // stays under the pointer when it jumps a slot.
                const sequence = moveTerminalTab(baseTabs, key, next);
                const offsetX = shift - (slotX(sequence, next) - startX);
                setDrag({ key, offsetX });
                if (next !== toIndex) {
                    toIndex = next;
                    setPreview(applyTerminalTabOrder(baseTabs, sequence));
                }
            };

            const handleUp = () => {
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
                setDrag(null);
                setPreview(null);
                if (moved && toIndex !== fromIndex) {
                    onReorderRef.current(moveTerminalTab(baseTabs, key, toIndex));
                }
            };

            document.addEventListener('mousemove', handleMove);
            document.addEventListener('mouseup', handleUp);
        },
        [enabled, gap, leading],
    );

    const tabProps = React.useCallback(
        (key: string) => {
            if (!enabled) {
                return {};
            }
            return {
                onLayout: (event: LayoutChangeEvent) => {
                    widthsRef.current.set(key, event.nativeEvent.layout.width);
                },
                onMouseDown: (event: { button?: number; clientX?: number; ctrlKey?: boolean; preventDefault?: () => void }) =>
                    handleMouseDown(key, event),
            };
        },
        [enabled, handleMouseDown],
    );

    return {
        dragOffsetX: drag?.offsetX ?? 0,
        draggingKey: drag?.key ?? null,
        onBarScroll,
        renderTabs: preview ?? tabs,
        tabProps,
    };
}

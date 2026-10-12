import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useChatStickToEnd } from './useChatStickToEnd';

const THRESHOLD = 100;
const VIEWPORT = 800;
const CONTENT = 5000;
const END = CONTENT - VIEWPORT;

function Harness() {
    api = useChatStickToEnd(THRESHOLD);
    return null;
}

let api: ReturnType<typeof useChatStickToEnd> | null = null;
let renderer: ReturnType<typeof create> | null = null;

function mount() {
    act(() => { renderer = create(React.createElement(Harness)); });
}

afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    api = null;
});

function scrollTo(offset: number, content = CONTENT) {
    const event = { nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 0, height: content }, layoutMeasurement: { width: 0, height: VIEWPORT } } };
    act(() => api!.onScroll(event as unknown as NativeSyntheticEvent<NativeScrollEvent>));
}

function drag(...offsets: number[]) {
    act(() => api!.onScrollBeginDrag());
    for (const offset of offsets) scrollTo(offset);
    act(() => api!.onScrollEndDrag());
}

describe('useChatStickToEnd', () => {
    it('lets go of the end on a short drag toward older messages', () => {
        mount();
        scrollTo(END);
        drag(END - 10, END - 40);
        // Well inside the 100px threshold, yet the reader moved away: no follow.
        expect(api!.stuck).toBe(false);
    });

    it('stays held while rows measuring in push the end away', () => {
        mount();
        scrollTo(END);
        scrollTo(END, CONTENT + 600);
        expect(api!.stuck).toBe(true);
    });

    it('takes hold again when a drag back toward the end rests within the threshold', () => {
        mount();
        scrollTo(END);
        drag(END - 300);
        expect(api!.stuck).toBe(false);
        drag(END - 250, END - 60);
        expect(api!.stuck).toBe(true);
    });

    it('does not take hold when a drag toward the end rests beyond the threshold', () => {
        mount();
        scrollTo(END);
        drag(END - 600);
        drag(END - 300);
        expect(api!.stuck).toBe(false);
    });

    it('waits for a fling toward the end to settle before taking hold', () => {
        mount();
        scrollTo(END);
        drag(END - 300);
        act(() => api!.onScrollBeginDrag());
        scrollTo(END - 200);
        act(() => api!.onScrollEndDrag());
        act(() => api!.onMomentumScrollBegin());
        scrollTo(END - 50);
        expect(api!.stuck).toBe(false);
        act(() => api!.onMomentumScrollEnd());
        expect(api!.stuck).toBe(true);
    });

    it('takes hold on reaching the end by any means', () => {
        mount();
        scrollTo(END);
        drag(END - 500);
        scrollTo(END);
        expect(api!.stuck).toBe(true);
    });

    it('ignores movement nobody dragged, such as a jump or the keyboard', () => {
        mount();
        scrollTo(END);
        scrollTo(END - 50);
        expect(api!.stuck).toBe(true);
    });

    it('sticks on a prompt only when resting near the end', () => {
        mount();
        scrollTo(END);
        drag(END - 50);
        expect(api!.stuck).toBe(false);
        let result = false;
        act(() => { result = api!.stickIfNear(); });
        expect(result).toBe(true);
        expect(api!.stuck).toBe(true);

        drag(END - 400);
        act(() => { result = api!.stickIfNear(); });
        expect(result).toBe(false);
        expect(api!.stuck).toBe(false);
    });
});

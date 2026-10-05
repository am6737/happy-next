import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import { useKeyboardSpace, useKeyboardVisible } from './useKeyboardVisible';

/**
 * A stand-in for the platform's keyboard events, so a test can decide which of
 * them fire and in what order. `react-native` is mocked to iOS on purpose: it
 * is the platform that reports a move *before* making it, which is the whole
 * difference under test.
 */
const bus = vi.hoisted(() => {
    type Listener = (event: { endCoordinates: { height: number } }) => void;
    const listeners = new Map<string, Set<Listener>>();

    return {
        add(name: string, listener: Listener) {
            const group = listeners.get(name) ?? new Set<Listener>();
            group.add(listener);
            listeners.set(name, group);
            return { remove: () => group.delete(listener) };
        },
        emit(name: string, event: { endCoordinates: { height: number } }) {
            for (const listener of Array.from(listeners.get(name) ?? [])) {
                listener(event);
            }
        },
        reset() {
            listeners.clear();
        },
    };
});

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    Keyboard: {
        addListener: (name: string, listener: (event: { endCoordinates: { height: number } }) => void) =>
            bus.add(name, listener),
    },
}));

const KEYBOARD = 336;

let visible = false;
let space = 0;

function Harness() {
    visible = useKeyboardVisible();
    space = useKeyboardSpace();
    return null;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    bus.reset();
    visible = false;
    space = 0;
    act(() => {
        create(React.createElement(Harness));
    });
});

describe('useKeyboardSpace', () => {
    it('takes the keyboard’s height as the room it needs', () => {
        act(() => {
            bus.emit('keyboardWillShow', { endCoordinates: { height: KEYBOARD } });
        });

        expect(space).toBe(KEYBOARD);
        expect(visible).toBe(true);
    });

    // The point of reading the height from a `will` event: a layout that waits
    // for the keyboard to be gone before giving the room back leaves whatever
    // is above it — a terminal and the shell resized to match — arriving a beat
    // after the keyboard has already left.
    it('gives the room back while the keyboard is still on its way out', () => {
        act(() => {
            bus.emit('keyboardWillShow', { endCoordinates: { height: KEYBOARD } });
        });
        act(() => {
            bus.emit('keyboardWillHide', { endCoordinates: { height: KEYBOARD } });
        });

        expect(space).toBe(0);
        expect(visible).toBe(false);
    });

    it('is at rest before any keyboard arrives', () => {
        expect(space).toBe(0);
    });
});

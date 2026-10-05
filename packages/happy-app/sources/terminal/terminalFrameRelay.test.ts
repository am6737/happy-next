import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalRelayedFrame } from 'happy-wire';

let socketHandler: ((frame: TerminalRelayedFrame) => void) | null = null;
const onMessage = vi.fn((_event: string, handler: (frame: TerminalRelayedFrame) => void) => {
    // The same single slot the real socket has: a second registration replaces the first.
    socketHandler = handler;
    return () => {
        socketHandler = null;
    };
});

vi.mock('@/sync/apiSocket', () => ({
    apiSocket: { onMessage: (...args: [string, (frame: TerminalRelayedFrame) => void]) => onMessage(...args) },
}));

import { subscribeTerminalFrames } from './terminalFrameRelay';

function frame(machineId: string, terminalId: string, revision = 1): TerminalRelayedFrame {
    return { machineId, terminalId, revision, payload: '' };
}

beforeEach(() => {
    onMessage.mockClear();
    socketHandler = null;
});

describe('subscribeTerminalFrames', () => {
    it('hands each terminal only its own frames', () => {
        const first = vi.fn();
        const second = vi.fn();
        const stopFirst = subscribeTerminalFrames('m', 't1', first);
        const stopSecond = subscribeTerminalFrames('m', 't2', second);

        socketHandler?.(frame('m', 't1'));
        socketHandler?.(frame('m', 't2'));
        socketHandler?.(frame('other', 't1'));

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        stopFirst();
        stopSecond();
    });

    it('keeps an earlier terminal hearing frames after a later one subscribes and leaves', () => {
        const first = vi.fn();
        const stopFirst = subscribeTerminalFrames('m', 't1', first);
        const stopSecond = subscribeTerminalFrames('m', 't2', vi.fn());
        stopSecond();

        socketHandler?.(frame('m', 't1'));

        expect(first).toHaveBeenCalledTimes(1);
        stopFirst();
    });

    it('registers with the socket once and releases it with the last subscriber', () => {
        const stopFirst = subscribeTerminalFrames('m', 't1', vi.fn());
        const stopSecond = subscribeTerminalFrames('m', 't2', vi.fn());
        expect(onMessage).toHaveBeenCalledTimes(1);

        stopFirst();
        expect(socketHandler).not.toBeNull();
        stopSecond();
        expect(socketHandler).toBeNull();
    });
});

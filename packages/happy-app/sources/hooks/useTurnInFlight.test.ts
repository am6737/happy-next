import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import type { Message } from '@/sync/typesMessage';
import { useTurnInFlight } from './useTurnInFlight';

const prompt = (id: string) => ({ kind: 'user-text', id }) as unknown as Message;
const reply = (id: string) => ({ kind: 'agent-text', id }) as unknown as Message;

let inFlight: boolean | undefined;
let renderer: ReturnType<typeof create> | null = null;

function Harness(props: { busy: boolean | undefined; messages: Message[] }) {
    inFlight = useTurnInFlight({ busy: props.busy, visibleMessages: props.messages });
    return null;
}

function render(busy: boolean | undefined, messages: Message[]) {
    act(() => {
        const element = React.createElement(Harness, { busy, messages });
        if (renderer) renderer.update(element);
        else renderer = create(element);
    });
    return inFlight;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
});

describe('useTurnInFlight', () => {
    const settled = [reply('r1'), prompt('p1')];

    it('holds a settled turn when busy arrives ahead of the prompt, and runs once the prompt lands', () => {
        expect(render(false, settled)).toBe(false);
        expect(render(true, settled)).toBe(false);
        expect(render(true, [prompt('p2'), ...settled])).toBe(true);
    });

    it('runs a turn the agent really resumes once the wait is over', () => {
        render(false, settled);
        expect(render(true, settled)).toBe(false);
        act(() => { vi.advanceTimersByTime(1600); });
        expect(inFlight).toBe(true);
    });

    it('runs at once a turn that turns busy together with its prompt', () => {
        render(false, settled);
        expect(render(true, [prompt('p2'), ...settled])).toBe(true);
    });

    it('is busy for a chat that opens busy', () => {
        expect(render(true, settled)).toBe(true);
    });
});

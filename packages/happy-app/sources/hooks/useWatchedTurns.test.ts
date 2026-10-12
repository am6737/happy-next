import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import type { TurnHeaderStatus } from '@/components/messageTurnTiming';
import { useWatchedTurns } from './useWatchedTurns';

const running: TurnHeaderStatus = { state: 'running', startedAt: 1 };
const done: TurnHeaderStatus = { state: 'done', startedAt: 1, completedAt: 2 };

let watched: ReadonlySet<string> | null = null;
let renderer: ReturnType<typeof create> | null = null;

function Harness(props: { headers: [string, TurnHeaderStatus][] }) {
    watched = useWatchedTurns(new Map(props.headers));
    return null;
}

function render(headers: [string, TurnHeaderStatus][]) {
    act(() => {
        const element = React.createElement(Harness, { headers });
        if (renderer) renderer.update(element);
        else renderer = create(element);
    });
    return [...watched!].sort();
}

afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    watched = null;
});

describe('useWatchedTurns', () => {
    it('leaves out turns that had settled when the list opened', () => {
        expect(render([['old', done], ['newest', done]])).toEqual([]);
    });

    it('counts the turn running when the list opened, and keeps it once it settles', () => {
        expect(render([['old', done], ['newest', running]])).toEqual(['newest']);
        expect(render([['old', done], ['newest', done]])).toEqual(['newest']);
    });

    it('counts a turn that begins while the list is open', () => {
        render([['old', done]]);
        expect(render([['old', done], ['next', running]])).toEqual(['next']);
        expect(render([['old', done], ['next', done], ['last', running]])).toEqual(['last', 'next']);
    });

    it('does not count a settled turn the agent picks up again', () => {
        render([['newest', done]]);
        expect(render([['newest', running]])).toEqual([]);
    });

    it('does not count a turn that arrives already settled', () => {
        render([['old', done]]);
        expect(render([['old', done], ['missed', done]])).toEqual([]);
    });

    it('hands back the same set until a turn joins it', () => {
        render([['newest', running]]);
        const first = watched;
        render([['newest', done]]);
        expect(watched).toBe(first);
    });

    it('starts again when the list mounts again', () => {
        render([['newest', running]]);
        act(() => renderer?.unmount());
        renderer = null;
        expect(render([['newest', done]])).toEqual([]);
    });
});

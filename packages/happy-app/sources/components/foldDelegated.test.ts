import { describe, expect, it } from 'vitest';
import { delegatedLabel, foldHidesRunningDelegatedTask } from './foldDelegated';
import type { Message } from '@/sync/typesMessage';

function call(id: string, name: string, result: unknown = null, input: unknown = {}): Message {
    return {
        kind: 'tool-call', id, localId: null, createdAt: 0, children: [],
        tool: { name, state: 'completed', input, createdAt: 0, startedAt: 0, completedAt: 1, description: null, result },
    };
}

const submit = (id: string, runId: string, title?: string) =>
    call(id, 'mcp__happy__orchestrator_submit', { runId }, title ? { title } : {});
const rows = (...messages: Message[]) => new Map(messages.map((m) => [m.id, m]));

describe('foldHidesRunningDelegatedTask', () => {
    it('is true when a hidden submit belongs to an active run', () => {
        const a = submit('a', 'run-1');
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a'], lineRow: null, messageById: rows(a), activeRunIds: ['run-1'] })).not.toBeNull();
    });

    it('is false once the run is no longer active', () => {
        const a = submit('a', 'run-1');
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a'], lineRow: null, messageById: rows(a), activeRunIds: ['run-2'] })).toBeNull();
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a'], lineRow: null, messageById: rows(a), activeRunIds: [] })).toBeNull();
    });

    it('ignores calls that are not a submit', () => {
        const a = call('a', 'Read', { runId: 'run-1' });
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a'], lineRow: null, messageById: rows(a), activeRunIds: ['run-1'] })).toBeNull();
    });

    it('looks at the row the line is drawn on', () => {
        const a = submit('a', 'run-1');
        expect(foldHidesRunningDelegatedTask({ hiddenIds: [], lineRow: a, messageById: rows(a), activeRunIds: ['run-1'] })).not.toBeNull();
        expect(foldHidesRunningDelegatedTask({ hiddenIds: [], lineRow: null, messageById: rows(a), activeRunIds: ['run-1'] })).toBeNull();
    });

    it('steps over ids with no row', () => {
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['gone'], lineRow: null, messageById: rows(), activeRunIds: ['run-1'] })).toBeNull();
    });

    it('carries the newest title and counts the runs going', () => {
        const a = submit('a', 'run-1', 'Fix login');
        const b = submit('b', 'run-2', 'Write docs');
        const c = submit('c', 'run-3', 'Already done');
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a', 'b', 'c'], lineRow: null, messageById: rows(a, b, c), activeRunIds: ['run-1', 'run-2'] }))
            .toEqual({ title: 'Write docs', count: 2 });
    });

    it('has no title when no call carried one', () => {
        const a = submit('a', 'run-1');
        expect(foldHidesRunningDelegatedTask({ hiddenIds: ['a'], lineRow: null, messageById: rows(a), activeRunIds: ['run-1'] }))
            .toEqual({ title: null, count: 1 });
    });
});

describe('delegatedLabel', () => {
    const several = (title: string, count: number) => `${title} x${count}`;
    it('says nothing when no task is running', () => {
        expect(delegatedLabel(null, several)).toBeUndefined();
    });

    it('falls back to a spinner without a title', () => {
        expect(delegatedLabel({ title: null, count: 2 }, several)).toBeNull();
    });

    it('is the title alone for one task and counts several', () => {
        expect(delegatedLabel({ title: 'Fix login', count: 1 }, several)).toBe('Fix login');
        expect(delegatedLabel({ title: 'Fix login', count: 3 }, several)).toBe('Fix login x3');
    });
});

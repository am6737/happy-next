import { describe, expect, it } from 'vitest';
import { getContextDefaultEntries, groupModelModes, resolveContextMachineStatus } from './orchestratorContextDisplay';

describe('groupModelModes', () => {
    it('folds effort variants of a model into one entry, in the listed order', () => {
        expect(groupModelModes([
            'default',
            'gpt-5.5-low',
            'gpt-5.5-medium',
            'gpt-5.5-high',
            'gpt-5.4-high',
            'gpt-5.5-xhigh',
        ])).toEqual([
            { model: 'default', efforts: [] },
            { model: 'gpt-5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
            { model: 'gpt-5.4', efforts: ['high'] },
        ]);
    });

    it('keeps a model whose own name ends like an effort-less mode, and the [1m] family suffix', () => {
        expect(groupModelModes(['claude-haiku-4-5', 'claude-opus-4-6[1m]-high', 'claude-opus-4-6[1m]-max', 'gemini-2.5-pro'])).toEqual([
            { model: 'claude-haiku-4-5', efforts: [] },
            { model: 'claude-opus-4-6[1m]', efforts: ['high', 'max'] },
            { model: 'gemini-2.5-pro', efforts: [] },
        ]);
    });

    it('does not repeat an effort', () => {
        expect(groupModelModes(['gpt-5.5-high', 'gpt-5.5-high'])).toEqual([{ model: 'gpt-5.5', efforts: ['high'] }]);
    });

    it('returns nothing for an empty list', () => {
        expect(groupModelModes([])).toEqual([]);
    });
});

describe('getContextDefaultEntries', () => {
    it('lists the reported defaults in reading order and skips the missing ones', () => {
        expect(getContextDefaultEntries({ retryBackoffMs: 2000, mode: 'async', maxConcurrency: 4, waitTimeoutMs: 600000 })).toEqual([
            { key: 'mode', kind: 'text', value: 'async' },
            { key: 'maxConcurrency', kind: 'count', value: 4 },
            { key: 'waitTimeout', kind: 'duration', value: 600000 },
            { key: 'retryBackoff', kind: 'duration', value: 2000 },
        ]);
    });

    it('keeps a zero value', () => {
        expect(getContextDefaultEntries({ retryBackoffMs: 0 })).toEqual([{ key: 'retryBackoff', kind: 'duration', value: 0 }]);
    });

    it('returns nothing without defaults', () => {
        expect(getContextDefaultEntries(undefined)).toEqual([]);
        expect(getContextDefaultEntries({})).toEqual([]);
    });
});

describe('resolveContextMachineStatus', () => {
    it('tells ready, connected-but-not-ready and offline machines apart', () => {
        expect(resolveContextMachineStatus({ online: true, dispatchReady: true })).toBe('ready');
        expect(resolveContextMachineStatus({ online: true, dispatchReady: false })).toBe('notReady');
        expect(resolveContextMachineStatus({ online: false, dispatchReady: false })).toBe('offline');
        expect(resolveContextMachineStatus({})).toBe('offline');
    });
});

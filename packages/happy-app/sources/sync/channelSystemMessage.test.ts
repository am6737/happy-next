import { describe, expect, it } from 'vitest';
import { governanceSystemMessage } from './channelSystemMessage';

describe('governance system messages', () => {
    it('formats budget warning amounts and recognizes transitions', () => {
        expect(governanceSystemMessage({ t: 'system', code: 'budget_warning', data: { spentUsd: 8.25, budgetUsd: 10 } })).toEqual({ code: 'budget_warning', spentUsd: '$8.25', budgetUsd: '$10.00', taskId: null });
        expect(governanceSystemMessage({ t: 'system', code: 'budget_paused', data: {} })).toEqual({ code: 'budget_paused', taskId: null });
        expect(governanceSystemMessage({ t: 'system', code: 'budget_resumed', data: {} })).toEqual({ code: 'budget_resumed', taskId: null });
    });
    it('extracts a task link and safely handles missing metadata', () => {
        expect(governanceSystemMessage({ t: 'system', code: 'task_self_assigned', data: { taskId: 'a/b', title: 'Fix', byHandle: 'atlas' } })).toEqual({ code: 'task_self_assigned', agent: '@atlas', title: 'Fix', taskId: 'a/b' });
        expect(governanceSystemMessage({ t: 'system', code: 'task_self_assigned', data: {} })).toEqual({ code: 'task_self_assigned', agent: '', title: '', taskId: null });
        expect(governanceSystemMessage({ t: 'system', code: 'run_failed', data: { runId: 'r1', name: 'Atlas', reason: 'session_error' } })).toEqual({ code: 'run_failed', name: 'Atlas', reason: 'session_error', runId: 'r1', taskId: null });
        expect(governanceSystemMessage({ t: 'system', code: 'run_failed', data: { reason: 'nonsense' } })).toEqual({ code: 'run_failed', name: '', reason: 'unknown', runId: null, taskId: null });
        expect(governanceSystemMessage({ t: 'system', code: 'context_reset', data: {} })).toBeNull();
    });
});

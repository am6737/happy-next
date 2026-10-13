import { describe, expect, it } from 'vitest';
import { channelSystemMessage, governanceSystemMessage } from './channelSystemMessage';

describe('governance system messages', () => {
    it('resolves member names and title changes with generic fallback data', () => {
        expect(channelSystemMessage({ t: 'system', code: 'member_added', data: { teammateIds: ['a', 'missing'] } }, id => ({ a: 'Ada' } as Record<string, string>)[id])).toEqual({ code: 'member_added', names: ['Ada'] });
        expect(channelSystemMessage({ t: 'system', code: 'member_removed', data: { teammateIds: ['missing'] } }, () => undefined)).toEqual({ code: 'member_removed', names: [] });
        expect(channelSystemMessage({ t: 'system', code: 'title_changed', data: { title: 'New' } })).toEqual({ code: 'title_changed', title: 'New' });
        expect(channelSystemMessage({ t: 'system', code: 'brief_changed', data: { cleared: true } })).toEqual({ code: 'brief_changed', cleared: true });
        expect(channelSystemMessage({ t: 'system', code: 'brief_changed', data: {} })).toEqual({ code: 'brief_changed', cleared: false });
    });
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
        expect(governanceSystemMessage({ t: 'system', code: 'context_compacted', data: {} })).toBeNull();
        expect(governanceSystemMessage({ t: 'system', code: 'context_lost', data: {} })).toBeNull();
        expect(governanceSystemMessage({ t: 'system', code: 'context_rolled', data: {} })).toBeNull();
    });
});

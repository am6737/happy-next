import { describe, expect, it } from 'vitest';
import { emptyTeammateTaskState, reduceTeammateTask, reduceTeammateTaskDetail, reduceTeammateTaskRun } from './teammateTasks';
import { testTask as task, testTaskDetail as detail, testTaskRun as run } from './teammateTaskTestFixtures';
describe('task cache updates', () => {
    it('inserts a socket task into the Agent list, detail and resource index', () => {
        const state = reduceTeammateTask(emptyTeammateTaskState, task);
        expect(state.teammateTasks.agent).toEqual([task]);
        expect(state.teammateTaskDetails[task.id]).toEqual({ task, runs: [], sessions: [] });
        expect(state.teammateTaskResourceIndex[task.resourceId!]).toEqual([task.id]);
        expect(emptyTeammateTaskState.teammateTasks).toEqual({});
    });
    it('keeps newest tasks first, including finished history and multiple Agents', () => {
        let state = reduceTeammateTask(emptyTeammateTaskState, task);
        state = reduceTeammateTask(state, { ...task, id: 'newer', teammateId: 'other', createdAt: 10, status: 'done' });
        state = reduceTeammateTask(state, { ...task, status: 'paused', updatedAt: 20 });
        expect(state.teammateTaskResourceIndex[task.resourceId!]).toEqual(['newer', task.id]);
        expect(state.teammateTaskDetails[task.id].task.status).toBe('paused');
    });
    it('does not let a late detail/list response replace a socket transition', () => {
        let state = reduceTeammateTaskDetail(emptyTeammateTaskState, detail);
        state = reduceTeammateTask(state, { ...task, updatedAt: 100, status: 'awaiting_input' });
        state = reduceTeammateTaskDetail(state, detail);
        expect(state.teammateTasks.agent[0].status).toBe('awaiting_input');
        expect(state.teammateTaskDetails[task.id].task.status).toBe('awaiting_input');
        expect(state.teammateTaskDetails[task.id].sessions).toEqual(detail.sessions);
    });
    it('merges run updates in details and preserves them across in-flight reads', () => {
        let state = reduceTeammateTaskDetail(emptyTeammateTaskState, detail);
        const baseline = state.teammateTaskDetails[task.id];
        const completed = { ...run, status: 'completed' as const, finishedAt: 50, costUsd: 0.2 };
        state = { ...state, teammateTaskDetails: reduceTeammateTaskRun(state.teammateTaskDetails, completed) };
        state = reduceTeammateTaskDetail(state, detail, baseline);
        expect(state.teammateTaskDetails[task.id].runs).toEqual([completed]);
        expect(reduceTeammateTaskRun(state.teammateTaskDetails, { ...run, taskId: null })).toBe(state.teammateTaskDetails);
    });
});

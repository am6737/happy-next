import { describe, expect, it } from 'vitest';
import { identifyFixedLegacyOrigin } from './legacyOrigin';
import type { OrchestratorDispatchPayload } from './common';

const payload: OrchestratorDispatchPayload = { executionId: 'execution', runId: 'run',
  taskId: 'task', dispatchToken: 'secret', provider: 'codex', executionType: 'initial',
  prompt: 'irrelevant', timeoutMs: 30_000 };
const state = { agents: [], teams: [], conversations: [], workItems: [], executions: [], messages: {} };
const task = { ok: true, data: { run: { runId: 'run' }, task: { taskId: 'task', provider: 'codex',
  executions: [{ executionId: 'execution', machineId: 'machine', provider: 'codex',
    executionType: 'initial' }] } } };

describe('fixed old Server Agent origin', () => {
  it('accepts generic only with a complete state and bound execution', () => {
    expect(identifyFixedLegacyOrigin(state, task, payload, 'machine')).toBe('generic');
    expect(() => identifyFixedLegacyOrigin({ ...state, nextCursor: null }, task, payload, 'machine')).toThrow();
    expect(() => identifyFixedLegacyOrigin({ ...state, workItems: undefined }, task, payload, 'machine')).toThrow();
    expect(() => identifyFixedLegacyOrigin(state, task, payload, 'other-machine')).toThrow();
    expect(() => identifyFixedLegacyOrigin(state, { ...task, data: { ...task.data,
      task: { ...task.data.task, executions: [] } } }, payload, 'machine')).toThrow();
  });

  it('detects the old WorkItem control task and rejects conflicting projections', () => {
    const agentState = { ...state,
      workItems: [{ id: 'work', assigneeId: 'agent', executionIds: ['task'] }],
      executions: [{ id: 'task', workItemId: 'work', agentId: 'agent' }] };
    expect(identifyFixedLegacyOrigin(agentState, task, payload, 'machine')).toBe('agent');
    expect(() => identifyFixedLegacyOrigin({ ...agentState, executions: [] }, task, payload, 'machine')).toThrow();
    expect(() => identifyFixedLegacyOrigin({ ...agentState, executions: [
      { id: 'task', workItemId: 'work', agentId: 'other' }] }, task, payload, 'machine')).toThrow();
  });
});

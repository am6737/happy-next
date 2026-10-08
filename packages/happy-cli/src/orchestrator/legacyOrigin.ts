import type { OrchestratorDispatchPayload } from './common';

const stateKeys = ['agents', 'conversations', 'executions', 'messages', 'teams', 'workItems'];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// This is the complete, unpaginated response of the fixed 08030b8 legacy state route.
export function identifyFixedLegacyOrigin(state: unknown, taskResponse: unknown,
  payload: OrchestratorDispatchPayload, machineId: string): 'agent' | 'generic' {
  if (!object(state) || Object.keys(state).sort().join(',') !== stateKeys.join(',')
    || !Array.isArray(state.agents) || !Array.isArray(state.teams)
    || !Array.isArray(state.conversations) || !Array.isArray(state.workItems)
    || !Array.isArray(state.executions) || !object(state.messages))
    throw new Error('Legacy Agent state completeness is unverified');
  if (!object(taskResponse) || taskResponse.ok !== true || !object(taskResponse.data)
    || !object(taskResponse.data.run) || !object(taskResponse.data.task))
    throw new Error('Legacy task identity is unavailable');
  const { run, task } = taskResponse.data;
  if (run.runId !== payload.runId || task.taskId !== payload.taskId
    || task.provider !== payload.provider || !Array.isArray(task.executions))
    throw new Error('Legacy task identity changed');
  const executions = task.executions.filter((row: unknown) => object(row)
    && row.executionId === payload.executionId);
  if (executions.length !== 1 || !object(executions[0])
    || executions[0].machineId !== machineId
    || executions[0].provider !== payload.provider
    || executions[0].executionType !== payload.executionType)
    throw new Error('Legacy execution identity changed');

  const seenWork = new Set<string>();
  for (const row of state.workItems) {
    if (!object(row) || typeof row.id !== 'string' || !row.id
      || seenWork.has(row.id) || typeof row.assigneeId !== 'string'
      || !row.assigneeId || !Array.isArray(row.executionIds)
      || row.executionIds.some((id: unknown) => typeof id !== 'string'))
      throw new Error('Legacy Agent work projection is incomplete');
    seenWork.add(row.id);
  }
  const seenExecution = new Set<string>();
  for (const row of state.executions) {
    if (!object(row) || typeof row.id !== 'string' || !row.id
      || seenExecution.has(row.id) || typeof row.workItemId !== 'string'
      || !seenWork.has(row.workItemId))
      throw new Error('Legacy Agent execution projection is incomplete');
    seenExecution.add(row.id);
  }
  const works = state.workItems.filter((row: Record<string, unknown>) =>
    (row.executionIds as string[]).includes(payload.taskId));
  const projected = state.executions.filter((row: Record<string, unknown>) =>
    row.id === payload.taskId);
  if (works.length === 0 && projected.length === 0) return 'generic';
  if (works.length !== 1 || projected.length !== 1
    || projected[0].workItemId !== works[0].id
    || projected[0].agentId !== works[0].assigneeId)
    throw new Error('Legacy Agent task projection changed');
  return 'agent';
}

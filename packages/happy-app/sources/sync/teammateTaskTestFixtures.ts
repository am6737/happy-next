import { TeammateTaskSchema, TeammateRunSchema } from 'happy-wire';
export const testTask = TeammateTaskSchema.parse({ id: 'task/with space', teammateId: 'agent', source: 'github-issue',
    resourceId: 'owner/repo#42', title: 'Fix issue', url: 'https://github.com/owner/repo/issues/42', status: 'todo',
    summary: null, prUrl: null, createdByTeammateId: null, createdAt: 1, updatedAt: 1 });
export const testTaskRun = TeammateRunSchema.parse({ id: 'run', teammateId: 'agent', threadId: 'thread', threadKind: 'task',
    taskId: testTask.id, trigger: 'task-assigned', status: 'queued', attempt: 1, failureReason: null,
    sessionId: null, costUsd: null, queuedAt: 1, startedAt: null, finishedAt: null });
export const testTaskDetail = { task: testTask, runs: [testTaskRun], sessions: [{ sessionId: 'worker', role: 'worker' as const, createdAt: 1 }] };

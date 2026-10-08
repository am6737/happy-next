import { describe, expect, it } from 'vitest';
import { AiCoordinatorContextSchema, AiCoordinatorDecisionSchema } from './aiCoordinator';

describe('Coordinator trust boundary', () => {
    const source = { conversationId: 'conversation', messageId: 'message' };
    it('rejects model-proposed privileges and execution paths', () => {
        const task = { intent: 'create_task', title: 'Review', requirements: 'Review README', assigneeId: 'reviewer', source };
        expect(AiCoordinatorDecisionSchema.safeParse(task).success).toBe(true);
        for (const injection of [{ permissionMode: 'guarded_auto' }, { workingDirectory: '/private' }, { runtime: 'untrusted' }]) {
            expect(AiCoordinatorDecisionSchema.safeParse({ ...task, ...injection }).success).toBe(false);
        }
    });
    it('requires an explicit task and traceable source for steering', () => {
        const update = { intent: 'update_task', targetWorkItemId: 'work', requirements: 'Add tests', source: { ...source, clarificationId: 'clarification' } };
        expect(AiCoordinatorDecisionSchema.safeParse(update).success).toBe(true);
        expect(AiCoordinatorDecisionSchema.safeParse({ ...update, targetWorkItemId: undefined }).success).toBe(false);
        expect(AiCoordinatorDecisionSchema.safeParse({ ...update, source: undefined }).success).toBe(false);
    });
    it('bounds delegation and rejects unassigned members', () => {
        const task = { taskKey: 'review', title: 'Review', requirements: 'Review README', assigneeId: 'reviewer' };
        const plan = { intent: 'delegate', targetWorkItemId: 'work', delegationKey: 'plan-1', tasks: [task], source };
        expect(AiCoordinatorDecisionSchema.safeParse(plan).success).toBe(true);
        expect(AiCoordinatorDecisionSchema.safeParse({ ...plan, tasks: Array(21).fill(task) }).success).toBe(false);
        expect(AiCoordinatorDecisionSchema.safeParse({ ...plan, tasks: [{ ...task, assigneeId: undefined }] }).success).toBe(false);
    });
    it('requires concrete clarification choices and a versioned context', () => {
        expect(AiCoordinatorDecisionSchema.safeParse({ intent: 'clarify', requirements: 'Fix it', question: 'Which task?', options: ['Task A', 'Task B'] }).success).toBe(true);
        expect(AiCoordinatorDecisionSchema.safeParse({ intent: 'clarify', requirements: 'Fix it', question: 'Which task?', options: [] }).success).toBe(false);
        const context = { version: 1, conversationId: 'conversation', history: [], currentWorkItems: [], availableAgents: [], pendingClarification: null, project: null };
        expect(AiCoordinatorContextSchema.safeParse(context).success).toBe(true);
        expect(AiCoordinatorContextSchema.safeParse({ ...context, version: 2 }).success).toBe(false);
        expect(AiCoordinatorContextSchema.safeParse({ ...context, history: Array(51).fill({ messageId: 'message', role: 'human', text: 'hello' }) }).success).toBe(false);
    });
});

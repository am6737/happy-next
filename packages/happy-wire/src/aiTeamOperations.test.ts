import { expect, it } from 'vitest';
import { AiConversationMessageInputSchema, AiIntegrationProofSchema, AiMessageResponseSchema, AiSteeringStatusSchema } from './aiTeamOperations';

it('retains steering and clarification identity and rejects injected execution settings', () => {
    const input = { text: 'Add tests', clientMessageId: 'message-1', mode: 'steer', targetWorkItemId: 'work', targetTaskId: 'task', clarificationId: 'clarification' };
    expect(AiConversationMessageInputSchema.parse(input)).toEqual(input);
    expect(AiConversationMessageInputSchema.safeParse({ ...input, permissionMode: 'guarded_auto' }).success).toBe(false);
    expect(AiConversationMessageInputSchema.safeParse({ ...input, clientMessageId: undefined }).success).toBe(false);
});
it('distinguishes enqueued steering from delivery', () => {
    expect(AiMessageResponseSchema.safeParse({ kind: 'update_task', targetWorkItemId: 'work', targetTaskId: 'task', steeringId: 'steering', status: 'queued' }).success).toBe(true);
    expect(AiSteeringStatusSchema.safeParse({ id: 'steering', status: 'delivered', attempts: 1, errorCode: null, deliveredAt: '2026-10-07T00:00:00Z' }).success).toBe(true);
    expect(AiSteeringStatusSchema.safeParse({ id: 'steering', status: 'queued', attempts: 1, errorCode: null, deliveredAt: null }).success).toBe(false);
});
it('rejects duplicate member identity, shared branches and shortened commits in a report', () => {
    const first = { taskId: 'alpha', branchName: 'happy-agent/alpha', sourceCommit: 'a'.repeat(40), integratedCommit: 'b'.repeat(40) };
    const second = { ...first, taskId: 'beta', branchName: 'happy-agent/beta', sourceCommit: 'c'.repeat(40) };
    const proof = { baseCommit: 'd'.repeat(40), aggregateCommit: 'e'.repeat(40), members: [first, second] };
    expect(AiIntegrationProofSchema.safeParse(proof).success).toBe(true);
    expect(AiIntegrationProofSchema.safeParse({ ...proof, members: [first, first] }).success).toBe(false);
    expect(AiIntegrationProofSchema.safeParse({ ...proof, members: [first, { ...second, branchName: first.branchName }] }).success).toBe(false);
    expect(AiIntegrationProofSchema.safeParse({ ...proof, aggregateCommit: 'e'.repeat(7) }).success).toBe(false);
});

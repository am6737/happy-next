import { z } from 'zod';

const id = z.string().min(1).max(200);
const commit = z.string().regex(/^[0-9a-f]{40}$/);
export const AiMessageOptionsSchema = z.object({
    mode: z.enum(['new', 'continue', 'steer']).optional(),
    targetWorkItemId: id.optional(), targetTaskId: id.optional(),
    assigneeId: id.optional(), clarificationId: id.optional(),
}).strict();
export const AiConversationMessageInputSchema = AiMessageOptionsSchema.extend({
    clientMessageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    text: z.string().trim().min(1).max(65536),
});
export const AiMessageResponseSchema = z.union([
    z.object({ kind: z.literal('clarify'), clarificationId: id, conversationId: id,
        question: z.string(), candidates: z.array(z.object({ id, name: z.string() })),
        targetWorkItemId: id.nullable(), options: z.array(z.string()).optional() }),
    z.object({ kind: z.literal('chat'), messageId: id, executionId: id, conversationId: id, runId: id }),
    z.object({ kind: z.literal('update_task'), targetWorkItemId: id, executionId: id, conversationId: id, runId: id }),
    z.object({ kind: z.literal('update_task'), targetWorkItemId: id, targetTaskId: id, steeringId: id, status: z.literal('queued') }),
    z.object({ kind: z.literal('create_task').optional(), workItemId: id, executionId: id, conversationId: id, runId: id, aggregateTaskId: id.optional() }),
]);
export const AiCollaborationSchema = z.object({
    workItemId: id, teamId: id.nullable(), aggregateTaskId: id,
    tasks: z.array(z.object({
        id, taskKey: z.string().nullable(), title: z.string().nullable(),
        status: z.enum(['queued', 'dispatching', 'running', 'completed', 'failed', 'cancelled', 'dependency_failed']),
        parentTaskId: id.nullable(), assignedAgentId: id.nullable(), dependsOnTaskKeys: z.array(z.string()),
        collaborationRole: z.string().nullable(), branchName: z.string().nullable(),
        commitSha: commit.nullable(), finalResponse: z.string().nullable(),
    })),
    audits: z.array(z.object({ taskId: id, fromAgentId: id.nullable(), toAgentId: id.nullable(),
        reason: z.string(), createdAt: z.string() })),
});
export const AiSteeringStatusSchema = z.object({
    id, status: z.enum(['pending', 'processing', 'delivered', 'blocked']),
    attempts: z.number().int().nonnegative(), errorCode: z.string().nullable(), deliveredAt: z.string().nullable(),
});
// A report is evidence to validate against persisted execution/DAG and Git.
// Parsing this schema does not make a runtime-supplied report trustworthy.
export const AiIntegrationProofSchema = z.object({
    baseCommit: commit, aggregateCommit: commit,
    members: z.array(z.object({ taskId: id, branchName: z.string().min(1).max(256),
        sourceCommit: commit, integratedCommit: commit }).strict()).min(2).max(8),
}).strict().superRefine((proof, context) => {
    if (new Set(proof.members.map((member) => member.taskId)).size !== proof.members.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Integration members must be distinct', path: ['members'] });
    if (new Set(proof.members.map((member) => member.branchName)).size !== proof.members.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Integration branches must be distinct', path: ['members'] });
});

export type AiMessageOptions = z.infer<typeof AiMessageOptionsSchema>;
export type AiConversationMessageInput = z.infer<typeof AiConversationMessageInputSchema>;
export type AiMessageResponse = z.infer<typeof AiMessageResponseSchema>;
export type AiCollaboration = z.infer<typeof AiCollaborationSchema>;
export type AiSteeringStatus = z.infer<typeof AiSteeringStatusSchema>;
export type AiIntegrationProof = z.infer<typeof AiIntegrationProofSchema>;

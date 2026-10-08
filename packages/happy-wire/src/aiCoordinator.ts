import { z } from 'zod';

const identifier = z.string().min(1).max(200);
const requirements = z.string().min(1).max(12000);
const source = z.object({
    conversationId: identifier,
    messageId: identifier,
    clarificationId: identifier.optional(),
}).strict();

// Model output is a proposal. Account, membership, permissions and task
// identity must still be checked against durable state by the server.
export const AiCoordinatorDecisionSchema = z.discriminatedUnion('intent', [
    z.object({ intent: z.literal('chat'), response: z.string().min(1).max(12000) }).strict(),
    z.object({
        intent: z.literal('clarify'), requirements,
        question: z.string().min(1).max(2000),
        options: z.array(z.string().min(1).max(500)).min(2).max(6),
        candidateAgentIds: z.array(identifier).max(20).default([]),
    }).strict(),
    z.object({
        intent: z.literal('create_task'), title: z.string().min(1).max(200),
        requirements, assigneeId: identifier, source,
    }).strict(),
    z.object({
        intent: z.literal('update_task'), targetWorkItemId: identifier,
        requirements, source,
    }).strict(),
    z.object({
        intent: z.literal('delegate'), targetWorkItemId: identifier,
        delegationKey: identifier,
        tasks: z.array(z.object({
            taskKey: identifier, title: z.string().min(1).max(200),
            requirements, assigneeId: identifier,
            dependsOn: z.array(identifier).max(20).default([]),
        }).strict()).min(1).max(20),
        source,
    }).strict(),
]);

export const AiCoordinatorContextSchema = z.object({
    version: z.literal(1),
    conversationId: identifier,
    history: z.array(z.object({
        messageId: identifier, role: z.enum(['human', 'agent']),
        text: z.string().max(12000), agentId: identifier.optional(),
    }).strict()).max(50),
    currentWorkItems: z.array(z.object({
        id: identifier, title: z.string().max(200), status: z.string().max(50),
        assigneeId: identifier, requirements: z.string().max(12000),
    }).strict()).max(50),
    availableAgents: z.array(z.object({
        id: identifier, name: z.string().max(200),
        teamIds: z.array(identifier).max(50), enabled: z.boolean(),
        allowDelegation: z.boolean(),
    }).strict()).max(100),
    pendingClarification: z.object({
        id: identifier, originalMessageId: identifier, requirements,
        question: z.string().max(2000),
        options: z.array(z.string().max(500)).max(6),
    }).strict().nullable(),
    targetWorkItemId: identifier.optional(),
    project: z.object({
        id: identifier, version: z.number().int().positive(),
        repository: z.string().max(500), defaultBranch: z.string().max(200),
        context: z.string().max(12000),
    }).strict().nullable(),
}).strict();

export type AiCoordinatorDecision = z.infer<typeof AiCoordinatorDecisionSchema>;
export type AiCoordinatorContext = z.infer<typeof AiCoordinatorContextSchema>;

import { z } from 'zod';

export const AiAgentSettingsSchema = z.object({
    instructions: z.string(),
    engine: z.enum(['claude-code', 'codex', 'gemini']),
    model: z.string(),
    workingDirectory: z.string(),
    permissionMode: z.enum(['read_only', 'approval', 'guarded_auto']),
    allowDelegation: z.boolean(),
});

export const AiAgentSchema = z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    description: z.string(),
    status: z.enum(['working', 'waiting', 'idle', 'reviewing', 'disabled']),
    statusLabel: z.string(),
    emoji: z.string(),
    skills: z.array(z.string()),
    responsibilities: z.array(z.string()),
    teamIds: z.array(z.string()),
    currentWorkId: z.string().nullable(),
    settings: AiAgentSettingsSchema,
    enabled: z.boolean().optional(),
    availability: z.enum(['online', 'offline', 'unavailable']).optional(),
});

export const AiTeamSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emoji: z.string(),
    leaderId: z.string(),
    memberIds: z.array(z.string()),
    instructions: z.string(),
    currentGoal: z.string(),
    progress: z.number().min(0).max(100),
});

export const AiWorkItemSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['todo', 'working', 'blocked', 'review', 'done']),
    statusLabel: z.string(),
    assigneeId: z.string(),
    teamId: z.string(),
    sourceType: z.enum(['github', 'dootask', 'session', 'execution']),
    sourceLabel: z.string(),
    summary: z.string(),
    requiresDecision: z.boolean(),
    sourceResourceId: z.string(),
    executionIds: z.array(z.string()),
    acceptanceStatus: z.enum(['pending', 'approved', 'changes_requested']).optional(),
});

export const AiExecutionEventSchema = z.object({
    id: z.string(),
    kind: z.enum(['status', 'comment', 'tool', 'result']),
    actor: z.enum(['system', 'human', 'agent']),
    agentId: z.string().optional(),
    title: z.string(),
    body: z.string().optional(),
    timeLabel: z.string(),
    status: z.enum(['queued', 'dispatched', 'running', 'waiting_human', 'reviewing', 'completed', 'failed', 'cancelled']).optional(),
});

export const AiExecutionSchema = z.object({
    id: z.string(),
    workItemId: z.string(),
    agentId: z.string(),
    status: z.enum(['queued', 'dispatched', 'running', 'waiting_human', 'reviewing', 'completed', 'failed', 'cancelled']),
    statusLabel: z.string(),
    triggerLabel: z.string(),
    startedAt: z.string(),
    durationLabel: z.string(),
    summary: z.string(),
    attempt: z.number().int().positive(),
    conversationId: z.string().optional(),
    sessionId: z.string().optional(),
    events: z.array(AiExecutionEventSchema),
});

export const AiConversationSchema = z.object({
    id: z.string(),
    kind: z.enum(['direct', 'group']),
    agentId: z.string(),
    teamId: z.string().nullable(),
    title: z.string(),
    subtitle: z.string(),
    lastMessage: z.string(),
    timeLabel: z.string(),
    unread: z.boolean(),
    emoji: z.string(),
    participantAgentIds: z.array(z.string()),
    humanParticipantCount: z.number().int().nonnegative(),
});

export const AiChatMessageSchema = z.discriminatedUnion('kind', [
    z.object({ id: z.string(), kind: z.literal('text'), sender: z.enum(['user', 'agent']), agentId: z.string().optional(), text: z.string(), timeLabel: z.string() }),
    z.object({ id: z.string(), kind: z.literal('decision'), sender: z.literal('agent'), agentId: z.string().optional(), title: z.string(), body: z.string(), options: z.array(z.string()), selectedOption: z.string().optional(), timeLabel: z.string() }),
    z.object({ id: z.string(), kind: z.literal('progress'), sender: z.literal('agent'), agentId: z.string().optional(), title: z.string(), completed: z.array(z.string()), active: z.array(z.string()), pending: z.array(z.string()), progress: z.number(), timeLabel: z.string() }),
    z.object({ id: z.string(), kind: z.literal('assignment'), sender: z.literal('agent'), agentId: z.string().optional(), title: z.string(), workItemIds: z.array(z.string()), timeLabel: z.string() }),
    z.object({ id: z.string(), kind: z.literal('work'), sender: z.literal('agent'), agentId: z.string().optional(), workItemId: z.string(), timeLabel: z.string() }),
    z.object({ id: z.string(), kind: z.literal('completion'), sender: z.literal('agent'), agentId: z.string().optional(), title: z.string(), body: z.string(), timeLabel: z.string() }),
]);

export const AiTeamDataSchema = z.object({
    agents: z.array(AiAgentSchema),
    teams: z.array(AiTeamSchema),
    workItems: z.array(AiWorkItemSchema),
    executions: z.array(AiExecutionSchema),
    conversations: z.array(AiConversationSchema),
    messages: z.record(z.string(), z.array(AiChatMessageSchema)),
});

export type AiAgentSettings = z.infer<typeof AiAgentSettingsSchema>;
export type AiAgent = z.infer<typeof AiAgentSchema>;
export type AiTeam = z.infer<typeof AiTeamSchema>;
export type AiWorkItem = z.infer<typeof AiWorkItemSchema>;
export type AiExecutionEvent = z.infer<typeof AiExecutionEventSchema>;
export type AiExecution = z.infer<typeof AiExecutionSchema>;
export type AiConversation = z.infer<typeof AiConversationSchema>;
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;
export type AiTeamData = z.infer<typeof AiTeamDataSchema>;

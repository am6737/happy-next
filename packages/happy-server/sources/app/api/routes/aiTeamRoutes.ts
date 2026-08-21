import { db } from '@/storage/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Fastify } from '../types';
import type {
    AiAgent,
    AiAgentSettings,
    AiChatMessage,
    AiConversation,
    AiExecution,
    AiExecutionEvent,
    AiTeam,
    AiTeamData,
    AiWorkItem,
} from 'happy-wire';
import { invokeUserRpc, listConnectedUserRpcMethods } from '../socket/rpcRegistry';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
type Provider = typeof PROVIDERS[number];
const PROVIDER_DETECTION_TIMEOUT_MS = 5_000;
const PROVIDER_CACHE_TTL_MS = 30_000;
const providerMachineCache = new Map<string, {
    expiresAt: number;
    machineSignature: string;
    machines: Map<Provider, string>;
}>();

const agentSettingsSchema = z.object({
    instructions: z.string().max(65_536),
    engine: z.enum(['claude-code', 'codex', 'gemini']),
    model: z.string().max(128),
    workingDirectory: z.string().max(1024),
    permissionMode: z.enum(['read_only', 'approval', 'guarded_auto']),
    allowDelegation: z.boolean(),
});

const agentInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    role: z.string().trim().max(200),
    description: z.string().trim().min(1).max(4000),
    emoji: z.string().max(32),
    skills: z.array(z.string().max(200)).max(64),
    responsibilities: z.array(z.string().max(500)).max(64),
    settings: agentSettingsSchema,
    enabled: z.boolean().default(true),
});

const teamInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(4000),
    emoji: z.string().max(32),
    leaderId: z.string().min(1),
    memberIds: z.array(z.string().min(1)).min(1).max(64),
    instructions: z.string().max(65_536),
    currentGoal: z.string().max(4000).default(''),
});

const assignmentSchema = z.object({
    agentId: z.string().min(1),
    teamId: z.string().optional(),
    conversationId: z.string().optional(),
    title: z.string().trim().min(1).max(256),
    summary: z.string().trim().min(1).max(65_536),
    sourceType: z.enum(['github', 'dootask', 'session', 'execution']).default('execution'),
    sourceLabel: z.string().max(512).default('Direct assignment'),
    sourceResourceId: z.string().max(1024).optional(),
});

const messageSchema = z.object({ text: z.string().trim().min(1).max(65_536) });
const acceptanceSchema = z.object({
    status: z.enum(['approved', 'changes_requested']),
    note: z.string().trim().max(65_536).optional(),
});

type WorkWithRun = Prisma.AiWorkItemGetPayload<{
    include: {
        orchestratorRun: {
            include: { tasks: { include: { executions: true } } };
        };
    };
}>;

function providerFor(settings: AiAgentSettings): Provider {
    if (settings.engine === 'claude-code') return 'claude';
    return settings.engine;
}

async function detectProviderMachines(accountId: string): Promise<Map<Provider, string>> {
    const methods = new Set(listConnectedUserRpcMethods(accountId));
    const machineIds = [...methods]
        .filter((method) => method.endsWith(':orchestrator-dispatch'))
        .map((method) => method.slice(0, -':orchestrator-dispatch'.length))
        .filter((machineId) => methods.has(`${machineId}:bash`))
        .sort();
    const machineSignature = machineIds.join(',');
    const cached = providerMachineCache.get(accountId);
    if (cached && cached.expiresAt > Date.now() && cached.machineSignature === machineSignature) {
        return cached.machines;
    }

    const detected = new Map<Provider, string>();
    const command = PROVIDERS
        .map((provider) => `command -v ${provider} >/dev/null 2>&1 && echo "${provider}:true" || echo "${provider}:false"`)
        .join('; ');
    const results = await Promise.allSettled(machineIds.map(async (machineId) => {
        const response = await invokeUserRpc(accountId, `${machineId}:bash`, { command, cwd: '/' }, PROVIDER_DETECTION_TIMEOUT_MS) as {
            success?: boolean;
            stdout?: string;
        };
        return { machineId, response };
    }));
    for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.response.success) continue;
        const available = new Set(result.value.response.stdout?.split('\n')
            .filter((line) => line.endsWith(':true'))
            .map((line) => line.slice(0, -':true'.length)) ?? []);
        for (const provider of PROVIDERS) {
            if (available.has(provider) && !detected.has(provider)) detected.set(provider, result.value.machineId);
        }
    }
    providerMachineCache.set(accountId, {
        expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
        machineSignature,
        machines: detected,
    });
    return detected;
}

function terminalTaskStatus(status: string): boolean {
    return ['completed', 'failed', 'cancelled', 'dependency_failed'].includes(status);
}

function workStatus(status: string): AiWorkItem['status'] {
    if (status === 'completed') return 'review';
    if (status === 'failed' || status === 'dependency_failed') return 'blocked';
    if (status === 'cancelled') return 'todo';
    return status === 'queued' ? 'todo' : 'working';
}

function executionStatus(status: string): AiExecution['status'] {
    if (status === 'dispatching') return 'dispatched';
    if (status === 'completed') return 'completed';
    if (status === 'failed' || status === 'dependency_failed' || status === 'timeout') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'queued') return 'queued';
    return 'running';
}

function statusLabel(status: AiExecution['status']): string {
    return ({
        queued: 'Queued',
        dispatched: 'Dispatched',
        running: 'Running',
        waiting_human: 'Waiting for human',
        reviewing: 'Reviewing',
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
    })[status];
}

function timeLabel(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 16);
}

export function boundedOutput(value: string | null): string | null {
    if (!value) return null;
    if ([...value].length <= 8_000) return value;
    return 'This execution completed, but its output was too large to display safely. Open the execution Session to inspect the full result.';
}

function durationLabel(start: Date, end?: Date | null): string {
    const elapsed = Math.max(0, (end?.getTime() ?? Date.now()) - start.getTime());
    if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`;
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    return `${Math.floor(elapsed / 3_600_000)}h ${Math.floor((elapsed % 3_600_000) / 60_000)}m`;
}

function projectExecution(work: WorkWithRun): AiExecution {
    const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId)
        ?? work.orchestratorRun.tasks[0];
    const attempts = [...(task?.executions ?? [])].sort((a, b) => a.attempt - b.attempt);
    const latest = attempts.at(-1);
    const status = executionStatus(task?.status ?? work.orchestratorRun.status);
    const events: AiExecutionEvent[] = [{
        id: `${work.id}-assigned`,
        kind: 'status',
        actor: 'human',
        title: 'Work assigned',
        body: work.summary,
        timeLabel: timeLabel(work.createdAt),
        status: 'queued',
    }];
    for (const attempt of attempts) {
        events.push({
            id: `${attempt.id}-dispatch`,
            kind: 'status',
            actor: 'system',
            title: `Attempt ${attempt.attempt} dispatched to ${attempt.machineId}`,
            timeLabel: timeLabel(attempt.createdAt),
            status: 'dispatched',
        });
        if (attempt.startedAt) events.push({
            id: `${attempt.id}-start`, kind: 'status', actor: 'agent', agentId: work.assigneeId,
            title: `Attempt ${attempt.attempt} started`, timeLabel: timeLabel(attempt.startedAt), status: 'running',
        });
        if (attempt.finishedAt) events.push({
            id: `${attempt.id}-finish`, kind: 'result', actor: 'agent', agentId: work.assigneeId,
            title: attempt.status === 'completed' ? 'Execution completed' : 'Execution ended',
            body: attempt.outputSummary ?? attempt.errorMessage ?? undefined,
            timeLabel: timeLabel(attempt.finishedAt), status: executionStatus(attempt.status),
        });
    }
    return {
        id: task?.id ?? work.orchestratorTaskId,
        workItemId: work.id,
        agentId: work.assigneeId,
        status,
        statusLabel: statusLabel(status),
        triggerLabel: 'Assigned by human',
        startedAt: timeLabel(latest?.startedAt ?? work.createdAt),
        durationLabel: durationLabel(latest?.startedAt ?? work.createdAt, latest?.finishedAt),
        summary: task?.outputSummary ?? task?.errorMessage ?? work.summary,
        attempt: latest?.attempt ?? 1,
        conversationId: work.conversationId,
        sessionId: latest?.workerSessionId ?? latest?.childSessionId ?? undefined,
        events,
    };
}

function projectWork(work: WorkWithRun): AiWorkItem {
    const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId)
        ?? work.orchestratorRun.tasks[0];
    let status = workStatus(task?.status ?? work.orchestratorRun.status);
    if (work.acceptanceStatus === 'approved') status = 'done';
    return {
        id: work.id,
        title: work.title,
        status,
        statusLabel: status === 'done' ? 'Done' : status === 'review' ? 'Ready for review' : status === 'blocked' ? 'Blocked' : status === 'todo' ? 'Queued' : 'In progress',
        assigneeId: work.assigneeId,
        teamId: work.teamId ?? '',
        sourceType: work.sourceType as AiWorkItem['sourceType'],
        sourceLabel: work.sourceLabel,
        summary: work.summary,
        requiresDecision: work.requiresDecision,
        sourceResourceId: work.sourceResourceId,
        executionIds: [work.orchestratorTaskId],
        acceptanceStatus: work.acceptanceStatus as AiWorkItem['acceptanceStatus'],
    };
}

async function buildState(accountId: string): Promise<AiTeamData> {
    const [agentRows, teamRows, conversationRows, workRows, providerMachines] = await Promise.all([
        db.aiAgent.findMany({ where: { accountId, archivedAt: null }, include: { teamMemberships: true }, orderBy: { createdAt: 'asc' } }),
        db.aiTeam.findMany({ where: { accountId, archivedAt: null }, include: { members: true }, orderBy: { createdAt: 'asc' } }),
        db.aiConversation.findMany({
            where: { accountId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
            orderBy: { updatedAt: 'desc' },
        }),
        db.aiWorkItem.findMany({
            where: { accountId },
            include: { orchestratorRun: { include: { tasks: { include: { executions: { orderBy: { attempt: 'asc' } } } } } } },
            orderBy: { createdAt: 'desc' },
        }),
        detectProviderMachines(accountId),
    ]);
    const activeByAgent = new Map<string, WorkWithRun>();
    for (const work of workRows) {
        const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
        if (task && !terminalTaskStatus(task.status) && !activeByAgent.has(work.assigneeId)) activeByAgent.set(work.assigneeId, work);
    }
    const agents: AiAgent[] = agentRows.map((row) => {
        const settings = row.settings as unknown as AiAgentSettings;
        const active = activeByAgent.get(row.id);
        const hasRuntime = providerMachines.has(providerFor(settings));
        return {
            id: row.id, name: row.name, role: row.role, description: row.description, emoji: row.emoji,
            status: !row.enabled ? 'disabled' : active ? 'working' : 'idle',
            statusLabel: !row.enabled ? 'Disabled' : active ? 'Working' : 'Idle',
            skills: row.skills, responsibilities: row.responsibilities,
            teamIds: row.teamMemberships.map((membership) => membership.teamId),
            currentWorkId: active?.id ?? null, settings, enabled: row.enabled,
            availability: row.enabled && hasRuntime ? 'online' : row.enabled ? 'offline' : 'unavailable',
        };
    });
    const teams: AiTeam[] = teamRows.map((row) => {
        const teamWorks = workRows.filter((work) => work.teamId === row.id);
        const completed = teamWorks.filter((work) => projectWork(work).status === 'done').length;
        return {
            id: row.id, name: row.name, description: row.description, emoji: row.emoji,
            leaderId: row.leaderId, memberIds: row.members.map((member) => member.agentId),
            instructions: row.instructions, currentGoal: row.currentGoal,
            progress: teamWorks.length ? Math.round(completed / teamWorks.length * 100) : 0,
        };
    });
    const messages: Record<string, AiChatMessage[]> = {};
    const conversations: AiConversation[] = conversationRows.map((row) => {
        const persisted = row.messages.map((message) => ({
            timestamp: message.createdAt.getTime(),
            message: { ...(message.payload as unknown as AiChatMessage), timeLabel: timeLabel(message.createdAt) },
        }));
        const derived: Array<{ timestamp: number; message: AiChatMessage }> = [];
        for (const work of workRows.filter((item) => item.conversationId === row.id)) {
            const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
            if (!task || !terminalTaskStatus(task.status)) continue;
            const body = boundedOutput(task.outputText) ?? boundedOutput(task.outputSummary) ?? boundedOutput(task.errorMessage);
            if (!body) continue;
            const message: AiChatMessage = task.status === 'completed'
                ? { id: `result-${task.id}`, kind: 'completion', sender: 'agent', agentId: work.assigneeId, title: work.title, body, timeLabel: timeLabel(task.updatedAt) }
                : { id: `result-${task.id}`, kind: 'text', sender: 'agent', agentId: work.assigneeId, text: `Execution failed: ${body}`, timeLabel: timeLabel(task.updatedAt) };
            derived.push({ timestamp: task.updatedAt.getTime(), message });
        }
        const combined = [...persisted, ...derived]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((item) => item.message);
        messages[row.id] = combined;
        const last = combined.at(-1);
        const lastMessage = last?.kind === 'text' ? last.text : last && 'title' in last ? last.title : '';
        const team = row.teamId ? teams.find((item) => item.id === row.teamId) : undefined;
        const agent = agents.find((item) => item.id === row.agentId);
        return {
            id: row.id, kind: row.kind as 'direct' | 'group', agentId: row.agentId, teamId: row.teamId,
            title: row.title, subtitle: team ? `${team.memberIds.length} agents` : agent?.role ?? '',
            lastMessage, timeLabel: last?.timeLabel ?? timeLabel(row.updatedAt), unread: false,
            emoji: team?.emoji ?? agent?.emoji ?? '', participantAgentIds: team?.memberIds ?? [row.agentId], humanParticipantCount: 1,
        };
    });
    return {
        agents,
        teams,
        workItems: workRows.map(projectWork),
        executions: workRows.map(projectExecution),
        conversations,
        messages,
    };
}

async function assertAgents(accountId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const count = await db.aiAgent.count({ where: { accountId, archivedAt: null, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new Error('One or more agents do not belong to this account');
}

async function ensureConversation(accountId: string, input: { agentId: string; teamId?: string | null }) {
    await assertAgents(accountId, [input.agentId]);
    const kind = input.teamId ? 'group' : 'direct';
    if (input.teamId) {
        const team = await db.aiTeam.findFirst({ where: { id: input.teamId, accountId, archivedAt: null } });
        if (!team) throw new Error('Team not found');
        return db.aiConversation.upsert({
            where: { accountId_scopeKey: { accountId, scopeKey: `team:${input.teamId}` } },
            create: { accountId, scopeKey: `team:${input.teamId}`, kind, agentId: input.agentId, teamId: input.teamId, title: team.name },
            update: { agentId: input.agentId, title: team.name },
        });
    }
    const agent = await db.aiAgent.findFirstOrThrow({ where: { id: input.agentId, accountId, archivedAt: null } });
    return db.aiConversation.upsert({
        where: { accountId_scopeKey: { accountId, scopeKey: `agent:${input.agentId}` } },
        create: { accountId, scopeKey: `agent:${input.agentId}`, kind, agentId: input.agentId, title: agent.name },
        update: { title: agent.name },
    });
}

function buildAgentPrompt(agent: { name: string; role: string; description: string; instructions: string; responsibilities: string[]; settings: unknown }, teamContext: string | null, goal: string, requirements: string): string {
    const settings = agent.settings as unknown as AiAgentSettings;
    return [
        `You are ${agent.name}, ${agent.role}.`,
        agent.description,
        agent.instructions || settings.instructions,
        agent.responsibilities.length ? `Responsibilities:\n- ${agent.responsibilities.join('\n- ')}` : '',
        teamContext ? `Team context:\n${teamContext}` : '',
        `Goal:\n${goal}`,
        `Requirements and delivery criteria:\n${requirements}`,
        teamContext && settings.allowDelegation ? 'You are the team lead. Use the orchestrator skill to delegate bounded independent work to appropriate team members when that improves the result, then synthesize and verify their outputs.' : '',
        'Execute the work in the configured working directory. Report concrete results, changed files, validation, and remaining risks.',
    ].filter(Boolean).join('\n\n');
}

async function submitWork(accountId: string, input: z.infer<typeof assignmentSchema>) {
    const agent = await db.aiAgent.findFirst({ where: { id: input.agentId, accountId, archivedAt: null } });
    if (!agent || !agent.enabled) throw new Error('Agent is unavailable');
    const team = input.teamId ? await db.aiTeam.findFirst({
        where: { id: input.teamId, accountId, archivedAt: null },
        include: { members: { include: { agent: true } } },
    }) : null;
    if (input.teamId && !team) throw new Error('Team not found');
    const conversation = input.conversationId
        ? await db.aiConversation.findFirst({ where: { id: input.conversationId, accountId } })
        : await ensureConversation(accountId, { agentId: agent.id, teamId: team?.id });
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.agentId !== agent.id || (conversation.teamId ?? undefined) !== (team?.id ?? undefined)) {
        throw new Error('Conversation does not match the selected agent or team');
    }
    const settings = agent.settings as unknown as AiAgentSettings;
    const provider = providerFor(settings);
    const targetMachineId = (await detectProviderMachines(accountId)).get(provider);
    if (!targetMachineId) throw new Error(`No connected runtime has the ${provider} CLI installed`);
    const model = settings.model && !['default', 'runtime-default'].includes(settings.model) ? settings.model : null;
    const teamContext = team
        ? [team.instructions, 'Members:', ...team.members.map(({ agent: member }) => `- ${member.name} (${member.role}): ${member.description}`)].join('\n')
        : null;
    const prompt = buildAgentPrompt(agent, teamContext, input.title, input.summary);
    return db.$transaction(async (tx) => {
        const run = await tx.orchestratorRun.create({
            data: { accountId, title: input.title, status: 'queued', maxConcurrency: 1, metadata: { aiAgentId: agent.id, aiTeamId: team?.id ?? null, conversationId: conversation.id } },
        });
        const task = await tx.orchestratorTask.create({
            data: {
                runId: run.id, seq: 1, taskKey: 'primary', title: input.title, provider, model,
                prompt, workingDirectory: settings.workingDirectory || null, permissionMode: settings.permissionMode,
                targetMachineId,
                retryMaxAttempts: 2,
                retryBackoffMs: 3_000, status: 'queued', dependsOnTaskKeys: [],
            },
        });
        const work = await tx.aiWorkItem.create({
            data: {
                accountId, title: input.title, summary: input.summary,
                sourceType: input.sourceType, sourceLabel: input.sourceLabel,
                sourceResourceId: input.sourceResourceId ?? task.id,
                assigneeId: agent.id, teamId: team?.id, conversationId: conversation.id,
                orchestratorRunId: run.id, orchestratorTaskId: task.id,
            },
        });
        const payload: AiChatMessage = { id: `message-${work.id}`, kind: 'text', sender: 'user', text: input.summary, timeLabel: new Date().toISOString() };
        await tx.aiMessage.create({ data: { conversationId: conversation.id, sender: 'user', payload: payload as Prisma.InputJsonValue } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        return { workItemId: work.id, executionId: task.id, conversationId: conversation.id, runId: run.id };
    });
}

export function aiTeamRoutes(app: Fastify) {
    app.get('/v1/ai-team/state', { preHandler: app.authenticate }, async (request, reply) => {
        return reply.send(await buildState(request.userId));
    });

    app.post('/v1/ai-team/agents', { preHandler: app.authenticate, schema: { body: agentInputSchema } }, async (request, reply) => {
        const input = request.body;
        const row = await db.aiAgent.create({ data: {
            accountId: request.userId, name: input.name, role: input.role, description: input.description,
            emoji: input.emoji, instructions: input.settings.instructions, skills: input.skills,
            responsibilities: input.responsibilities, settings: input.settings as Prisma.InputJsonValue, enabled: input.enabled,
        } });
        return reply.code(201).send({ id: row.id });
    });

    app.put('/v1/ai-team/agents/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }), body: agentInputSchema } }, async (request, reply) => {
        const current = await db.aiAgent.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!current) return reply.code(404).send({ error: 'Agent not found' });
        const input = request.body;
        await db.aiAgent.update({ where: { id: current.id }, data: {
            name: input.name, role: input.role, description: input.description, emoji: input.emoji,
            instructions: input.settings.instructions, skills: input.skills, responsibilities: input.responsibilities,
            settings: input.settings as Prisma.InputJsonValue, enabled: input.enabled,
        } });
        return reply.send({ ok: true });
    });

    app.post('/v1/ai-team/agents/:id/duplicate', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const source = await db.aiAgent.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!source) return reply.code(404).send({ error: 'Agent not found' });
        const row = await db.aiAgent.create({ data: {
            accountId: request.userId, name: `${source.name} Copy ${Date.now().toString(36)}`, role: source.role,
            description: source.description, emoji: source.emoji, instructions: source.instructions,
            skills: source.skills, responsibilities: source.responsibilities, settings: source.settings, enabled: source.enabled,
        } });
        return reply.code(201).send({ id: row.id });
    });

    app.delete('/v1/ai-team/agents/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const agent = await db.aiAgent.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null }, include: { ledTeams: { where: { archivedAt: null } } } });
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
        if (agent.ledTeams.length) return reply.code(409).send({ error: 'Assign another team leader before deleting this agent' });
        await db.aiAgent.update({ where: { id: agent.id }, data: { archivedAt: new Date(), enabled: false } });
        return reply.code(204).send();
    });

    app.post('/v1/ai-team/teams', { preHandler: app.authenticate, schema: { body: teamInputSchema } }, async (request, reply) => {
        const input = request.body;
        const memberIds = [...new Set([input.leaderId, ...input.memberIds])];
        await assertAgents(request.userId, memberIds);
        const row = await db.aiTeam.create({ data: {
            accountId: request.userId, name: input.name, description: input.description, emoji: input.emoji,
            instructions: input.instructions, currentGoal: input.currentGoal, leaderId: input.leaderId,
            members: { create: memberIds.map((agentId) => ({ agentId })) },
        } });
        return reply.code(201).send({ id: row.id });
    });

    app.put('/v1/ai-team/teams/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }), body: teamInputSchema } }, async (request, reply) => {
        const team = await db.aiTeam.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!team) return reply.code(404).send({ error: 'Team not found' });
        const input = request.body;
        const memberIds = [...new Set([input.leaderId, ...input.memberIds])];
        await assertAgents(request.userId, memberIds);
        await db.$transaction(async (tx) => {
            await tx.aiTeamMember.deleteMany({ where: { teamId: team.id } });
            await tx.aiTeam.update({ where: { id: team.id }, data: {
                name: input.name, description: input.description, emoji: input.emoji,
                instructions: input.instructions, currentGoal: input.currentGoal, leaderId: input.leaderId,
                members: { create: memberIds.map((agentId) => ({ agentId })) },
            } });
        });
        return reply.send({ ok: true });
    });

    app.delete('/v1/ai-team/teams/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const result = await db.aiTeam.updateMany({ where: { id: request.params.id, accountId: request.userId, archivedAt: null }, data: { archivedAt: new Date() } });
        if (!result.count) return reply.code(404).send({ error: 'Team not found' });
        return reply.code(204).send();
    });

    app.post('/v1/ai-team/conversations', {
        preHandler: app.authenticate,
        schema: { body: z.object({ agentId: z.string(), teamId: z.string().nullable().optional() }) },
    }, async (request, reply) => {
        const conversation = await ensureConversation(request.userId, request.body);
        return reply.send({ id: conversation.id });
    });

    app.post('/v1/ai-team/assignments', { preHandler: app.authenticate, schema: { body: assignmentSchema } }, async (request, reply) => {
        try {
            return reply.code(201).send(await submitWork(request.userId, request.body));
        } catch (error) {
            return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to create assignment' });
        }
    });

    app.post('/v1/ai-team/conversations/:id/messages', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: messageSchema },
    }, async (request, reply) => {
        const conversation = await db.aiConversation.findFirst({ where: { id: request.params.id, accountId: request.userId } });
        if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
        const text = request.body.text;
        const result = await submitWork(request.userId, {
            agentId: conversation.agentId, teamId: conversation.teamId ?? undefined, conversationId: conversation.id,
            title: text.split('\n')[0].slice(0, 120), summary: text,
            sourceType: 'execution', sourceLabel: 'Conversation', sourceResourceId: conversation.id,
        });
        return reply.code(201).send(result);
    });

    app.post('/v1/ai-team/work-items/:id/acceptance', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: acceptanceSchema },
    }, async (request, reply) => {
        const work = await db.aiWorkItem.findFirst({
            where: { id: request.params.id, accountId: request.userId },
            include: { orchestratorRun: { include: { tasks: true } } },
        });
        if (!work) return reply.code(404).send({ error: 'Work item not found' });
        const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
        if (!task || task.status !== 'completed') return reply.code(409).send({ error: 'Only completed work can be accepted or revised' });
        if (request.body.status === 'approved') {
            await db.$transaction(async (tx) => {
                await tx.aiWorkItem.update({ where: { id: work.id }, data: { acceptanceStatus: request.body.status, requiresDecision: false } });
                if (!request.body.note) return;
                const payload: AiChatMessage = { id: `acceptance-${work.id}-${Date.now()}`, kind: 'text', sender: 'user', text: request.body.note, timeLabel: new Date().toISOString() };
                await tx.aiMessage.create({ data: { conversationId: work.conversationId, sender: 'user', payload: payload as Prisma.InputJsonValue } });
            });
            return reply.send({ ok: true });
        }
        const note = request.body.note || 'Revise the delivery based on the execution result and address the remaining issues.';
        const revision = await submitWork(request.userId, {
            agentId: work.assigneeId,
            teamId: work.teamId ?? undefined,
            conversationId: work.conversationId,
            title: `Revise: ${work.title}`,
            summary: note,
            sourceType: 'execution',
            sourceLabel: 'Human review',
            sourceResourceId: work.id,
        });
        await db.aiWorkItem.update({ where: { id: work.id }, data: { acceptanceStatus: 'changes_requested', requiresDecision: false } });
        return reply.send({ ok: true, revision });
    });
}

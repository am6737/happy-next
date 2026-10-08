import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isApprovalTerminalFailure } from '@/app/ai/approvalTerminalFailure';
import { db } from '@/storage/db';
import type { Fastify } from '../types';
import { claimInbound, failInbound } from './aiInboundRequest';
import { assertExecutionCapabilityTx, authorizeWorkItemTx } from '@/app/ai/workspaceAuth';

const delegationSchema = z.object({
    dispatchToken: z.string().min(1),
    capability: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    delegationKey: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
    assignedAgentId: z.string().min(1),
    title: z.string().trim().min(1).max(256),
    requirements: z.string().trim().min(1).max(32_768),
    dependsOnTaskIds: z.array(z.string()).max(8).default([]),
});

class DelegationConflict extends Error {
    constructor(message: string, readonly status = 409) { super(message); }
}

async function lockEnabledAgent(tx: Prisma.TransactionClient, accountId: string,
    agentId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AiAgent" WHERE id=${agentId} AND "accountId"=${accountId}
        FOR UPDATE`;
    if (rows.length !== 1 || !await tx.aiAgent.findFirst({ where: {
        id: agentId, accountId, enabled: true, archivedAt: null,
    }, select: { id: true } })) {
        throw new DelegationConflict('Member is unavailable', 403);
    }
}

export function aiDelegationRoutes(app: Fastify) {
    const commandBody = z.object({ clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) });
    app.post('/v1/ai-team/work-items/:id/cancel', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: commandBody },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'run',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        const work = access.work;
        const clientMessageId = request.userId === work.accountId
            ? request.body.clientRequestId
            : `actor:${request.userId}:${request.body.clientRequestId}`;
        const claim = await claimInbound({ accountId: work.accountId, conversationId: work.conversationId,
            clientMessageId }, { action: 'cancel', actorAccountId: request.userId,
            workItemId: request.params.id });
        if (claim.kind === 'completed') return reply.send(claim.response);
        if (claim.kind === 'conflict') return reply.code(409).send({ error: 'Client request id conflict' });
        if (claim.kind === 'processing') return reply.code(503).send({ error: 'Request is processing' });
        try {
            const result = await db.$transaction(async (tx) => {
                if (!await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                    workItemId: request.params.id, operation: 'run' })) {
                    throw new Error('Workspace run permission was revoked');
                }
                const run = await tx.orchestratorRun.findFirst({ where: { id: work.orchestratorRunId,
                    accountId: work.accountId }, select: { status: true } });
                if (!run) throw new Error('Run not found');
                if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
                    await tx.orchestratorRun.updateMany({ where: { id: work.orchestratorRunId,
                        accountId: work.accountId, status: { notIn: ['completed', 'failed', 'cancelled'] } },
                        data: { status: 'canceling', cancelRequestedAt: new Date() } });
                    await tx.orchestratorTask.updateMany({ where: { runId: work.orchestratorRunId,
                        status: 'queued' }, data: { status: 'cancelled', nextAttemptAt: null,
                            errorCode: 'RUN_CANCELLED' } });
                    if (run.status !== 'canceling') await tx.aiWorkItemAudit.create({ data: {
                        workItemId: work.id, actorAccountId: request.userId,
                        action: 'cancel_requested', before: { runStatus: run.status },
                        after: { runStatus: 'canceling' },
                    } });
                }
                const response = { workItemId: request.params.id,
                    status: ['completed', 'failed', 'cancelled'].includes(run.status) ? run.status : 'canceling' };
                const saved = await tx.aiInboundRequest.updateMany({ where: { ...claim.claim,
                    status: 'processing' }, data: { status: 'completed', response,
                    claimOwner: null, leaseUntil: null } });
                if (!saved.count) throw new Error('Request claim expired');
                return response;
            });
            return reply.send(result);
        } catch (error) {
            await failInbound(claim.claim);
            return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to cancel' });
        }
    });

    app.post('/v1/ai-team/work-items/:id/retry', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: commandBody },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'run',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        const work = access.work;
        const clientMessageId = request.userId === work.accountId
            ? request.body.clientRequestId
            : `actor:${request.userId}:${request.body.clientRequestId}`;
        const claim = await claimInbound({ accountId: work.accountId, conversationId: work.conversationId,
            clientMessageId }, { action: 'retry', actorAccountId: request.userId,
            workItemId: request.params.id });
        if (claim.kind === 'completed') return reply.send(claim.response);
        if (claim.kind === 'conflict') return reply.code(409).send({ error: 'Client request id conflict' });
        if (claim.kind === 'processing') return reply.code(503).send({ error: 'Request is processing' });
        try {
            const result = await db.$transaction(async (tx) => {
                if (!await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                    workItemId: request.params.id, operation: 'run' })) {
                    throw new Error('Workspace run permission was revoked');
                }
                const task = await tx.orchestratorTask.findFirst({ where: { id: work.orchestratorTaskId,
                    runId: work.orchestratorRunId, run: { accountId: work.accountId } } });
                if (!task || task.status !== 'failed') throw new Error('Task is not retryable');
                if (isApprovalTerminalFailure(task.errorCode)) {
                    throw new Error('Approval outcome requires a separately reviewed new task');
                }
                const latest = await tx.orchestratorExecution.findFirst({ where: { taskId: task.id },
                    orderBy: { attempt: 'desc' } });
                if (!latest || task.targetMachineId && latest.machineId !== task.targetMachineId) {
                    throw new Error('Original machine identity is unavailable');
                }
                const moved = await tx.orchestratorTask.updateMany({ where: { id: task.id,
                    status: 'failed' }, data: { status: 'queued', errorCode: null,
                    errorMessage: null, nextAttemptAt: null } });
                if (!moved.count) throw new Error('Task changed');
                const execution = await tx.orchestratorExecution.create({ data: {
                    runId: task.runId, taskId: task.id, machineId: latest.machineId,
                    provider: task.provider, model: task.model, status: 'queued',
                    attempt: latest.attempt + 1, dispatchToken: randomUUID(),
                    executionType: latest.childSessionId ? 'resume' : 'initial',
                    childSessionId: latest.childSessionId, timeoutMs: task.timeoutMs,
                } });
                await tx.aiWorkItemAudit.create({ data: { workItemId: work.id,
                    actorAccountId: request.userId, action: 'retry_requested',
                    before: { taskStatus: 'failed', executionId: latest.id },
                    after: { taskStatus: 'queued', executionId: execution.id },
                } });
                await tx.orchestratorRun.update({ where: { id: task.runId }, data: {
                    status: 'running', completedAt: null, cancelRequestedAt: null,
                } });
                const response = { workItemId: request.params.id, runId: task.runId,
                    executionId: execution.id, status: 'queued' };
                const saved = await tx.aiInboundRequest.updateMany({ where: { ...claim.claim,
                    status: 'processing' }, data: { status: 'completed', response,
                    claimOwner: null, leaseUntil: null } });
                if (!saved.count) throw new Error('Request claim expired');
                return response;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return reply.send(result);
        } catch (error) {
            await failInbound(claim.claim);
            return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to retry' });
        }
    });

    app.post('/v1/ai-team/work-items/:id/steering', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: z.object({
            clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
            targetTaskId: z.string().min(1).optional(),
            text: z.string().trim().min(1).max(65_536),
        }).strict() },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'run',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        const work = access.work;
        const clientMessageId = request.userId === work.accountId
            ? request.body.clientRequestId
            : `actor:${request.userId}:${request.body.clientRequestId}`;
        const claim = await claimInbound({ accountId: work.accountId,
            conversationId: work.conversationId, clientMessageId }, {
            action: 'steering', actorAccountId: request.userId,
            workItemId: work.id, targetTaskId: request.body.targetTaskId ?? null,
            text: request.body.text,
        });
        if (claim.kind === 'completed') return reply.code(202).send(claim.response);
        if (claim.kind === 'conflict') return reply.code(409).send({ error: 'Client request id conflict' });
        if (claim.kind === 'processing') return reply.code(503).send({ error: 'Request is processing' });
        try {
            const response = await db.$transaction(async tx => {
                if (!await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                    workItemId: work.id, operation: 'run' })) {
                    throw new Error('Workspace run permission was revoked');
                }
                const active = await tx.orchestratorExecution.findMany({ where: {
                    runId: work.orchestratorRunId, status: 'running',
                    ...(request.body.targetTaskId ? { taskId: request.body.targetTaskId } : {}),
                }, take: 2, select: { taskId: true } });
                if (active.length !== 1) throw new Error(active.length
                    ? 'Select one active task to steer' : 'No active task to steer');
                const steering = await tx.aiSteeringMessage.create({ data: {
                    accountId: work.accountId, actorAccountId: request.userId,
                    conversationId: work.conversationId, workItemId: work.id,
                    targetTaskId: active[0].taskId, clientMessageId,
                    text: request.body.text,
                } });
                await tx.aiWorkItemAudit.create({ data: { workItemId: work.id,
                    actorAccountId: request.userId, action: 'steering_requested',
                    after: { steeringId: steering.id, targetTaskId: active[0].taskId },
                } });
                const messageId = `message-${randomUUID()}`;
                await tx.aiMessage.create({ data: { id: messageId,
                    conversationId: work.conversationId, clientMessageId,
                    sender: 'user', payload: { id: messageId, kind: 'text',
                        sender: 'user', text: request.body.text,
                        actorAccountId: request.userId,
                        timeLabel: new Date().toISOString() } } });
                const result = { workItemId: work.id, targetTaskId: active[0].taskId,
                    steeringId: steering.id, status: 'queued' as const };
                const saved = await tx.aiInboundRequest.updateMany({ where: { ...claim.claim,
                    status: 'processing' }, data: { status: 'completed', response: result,
                    claimOwner: null, leaseUntil: null } });
                if (!saved.count) throw new Error('Request claim expired');
                return result;
            });
            return reply.code(202).send(response);
        } catch (error) {
            await failInbound(claim.claim);
            return reply.code(409).send({ error: error instanceof Error
                ? error.message : 'Unable to queue steering' });
        }
    });

    app.get('/v1/ai-team/tasks/:id/git-identity', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const task = await db.orchestratorTask.findFirst({ where: { id: request.params.id,
            run: { accountId: request.userId } }, include: { run: { select: { metadata: true } },
            executions: { orderBy: { attempt: 'desc' }, take: 1,
                select: { id: true, machineId: true, status: true } } } });
        if (!task) return reply.code(404).send({ error: 'Task not found' });
        const metadata = task.run.metadata as { githubRepositoryId?: string } | null;
        const repositoryId = metadata?.githubRepositoryId;
        const grant = repositoryId && /^\d+$/.test(repositoryId)
            ? await db.aiGithubRepositoryGrant.findUnique({ where: { accountId_repositoryId: {
                accountId: request.userId, repositoryId: BigInt(repositoryId),
            } }, select: { fullName: true } }) : null;
        return reply.send({ taskId: task.id, runId: task.runId,
            machineId: task.executions[0]?.machineId ?? task.targetMachineId,
            executionId: task.executions[0]?.id ?? null,
            repositoryId: grant ? repositoryId : null, repository: grant?.fullName ?? null,
            baseCommit: task.baseCommit, branchName: task.branchName, commitSha: task.commitSha });
    });

    app.get('/v1/ai-team/work-items/:id/integration-verification', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'view',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        const row = await db.aiIntegrationVerification.findFirst({ where: {
            accountId: access.work.accountId,
            taskId: access.work.orchestratorTaskId }, orderBy: { createdAt: 'desc' }, select: {
            executionId: true, status: true, attempts: true, errorCode: true, verifiedAt: true,
        } });
        return reply.send(row ?? { status: 'unavailable' });
    });

    app.post('/v1/ai-team/work-items/:id/integration-verification/retry', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async (tx) => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'run' });
            if (!access) return 'not_found' as const;
            const work = access.work;
            const row = await tx.aiIntegrationVerification.findFirst({ where: {
                accountId: work.accountId,
                taskId: work.orchestratorTaskId, status: 'blocked' }, orderBy: { createdAt: 'desc' } });
            if (!row) return 'conflict' as const;
            const changed = await tx.aiIntegrationVerification.updateMany({ where: {
                executionId: row.executionId, status: 'blocked',
            }, data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), errorCode: null } });
            if (!changed.count) return 'conflict' as const;
            await tx.orchestratorTask.updateMany({ where: { id: work.orchestratorTaskId,
                runId: work.orchestratorRunId, status: 'failed', errorCode: 'INTEGRATION_VERIFICATION_FAILED' },
                data: { status: 'running', errorCode: null, errorMessage: null } });
            await tx.orchestratorRun.updateMany({ where: { id: work.orchestratorRunId,
                accountId: work.accountId, status: 'failed' }, data: { status: 'running', completedAt: null } });
            return 'pending' as const;
        });
        if (result === 'not_found') return reply.code(404).send({ error: 'Work item not found' });
        if (result === 'conflict') return reply.code(409).send({ error: 'No blocked integration verification' });
        return reply.send({ status: result });
    });

    app.get('/v1/ai-team/work-items/:id/steering/:steeringId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string(), steeringId: z.string() }) },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'view',
        }));
        if (!access) return reply.code(404).send({ error: 'Steering message not found' });
        const row = await db.aiSteeringMessage.findFirst({ where: { id: request.params.steeringId,
            workItemId: request.params.id, accountId: access.work.accountId }, select: {
            id: true, status: true, attempts: true, errorCode: true, deliveredAt: true,
        } });
        if (!row) return reply.code(404).send({ error: 'Steering message not found' });
        return reply.send(row);
    });

    app.post('/v1/ai-team/work-items/:id/steering/:steeringId/retry', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string(), steeringId: z.string() }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'run' });
            if (!access) return null;
            return tx.aiSteeringMessage.updateMany({ where: { id: request.params.steeringId,
                workItemId: request.params.id, accountId: access.work.accountId,
                status: 'blocked',
            }, data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(),
                errorCode: null } });
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        if (!result.count) return reply.code(409).send({ error: 'Steering message is not retryable' });
        return reply.send({ status: 'pending' });
    });

    app.get('/v1/ai-team/work-items/:id/collaboration', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id, operation: 'view',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        const work = access.work;
        const [tasks, audits] = await Promise.all([
            db.orchestratorTask.findMany({ where: { runId: work.orchestratorRunId },
                orderBy: { seq: 'asc' }, select: { id: true, taskKey: true, title: true,
                    status: true, parentTaskId: true, assignedAgentId: true, dependsOnTaskKeys: true,
                    collaborationRole: true, branchName: true, commitSha: true, finalResponse: true } }),
            db.aiDelegationAudit.findMany({ where: { accountId: work.accountId,
                task: { runId: work.orchestratorRunId } }, orderBy: { createdAt: 'asc' },
                select: { taskId: true, fromAgentId: true, toAgentId: true, reason: true, createdAt: true } }),
        ]);
        return reply.send({ workItemId: work.id, teamId: work.teamId,
            aggregateTaskId: work.orchestratorTaskId, tasks: tasks.map((task) => ({ ...task,
                finalResponse: task.finalResponse?.slice(0, 8_000) ?? null })), audits });
    });

    app.post('/v1/ai-team/tasks/:id/delegations', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: delegationSchema },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { id } = request.params;
        const body = request.body;
        const hash = createHash('sha256').update(JSON.stringify({ assignedAgentId: body.assignedAgentId,
            title: body.title, requirements: body.requirements,
            dependsOnTaskIds: [...new Set(body.dependsOnTaskIds)].sort() })).digest('hex');
        try {
            const result = await db.$transaction(async (tx) => {
                const parent = await tx.orchestratorTask.findFirst({ where: { id, run: { accountId } },
                    include: { run: { include: { aiWorkItem: true } } } });
                if (!parent || parent.collaborationRole !== 'leader_plan' || parent.delegationDepth !== 0
                    || !parent.run.aiWorkItem?.teamId) throw new DelegationConflict('Leader task not found', 404);
                const execution = await tx.orchestratorExecution.findFirst({ where: {
                    taskId: id, runId: parent.runId, dispatchToken: body.dispatchToken,
                }, select: { id: true, status: true, machineId: true,
                    capabilityProtocolVersion: true } });
                if (!execution) throw new DelegationConflict('Leader execution token is invalid');
                const existing = await tx.orchestratorTask.findFirst({ where: {
                    parentTaskId: id, delegationKey: body.delegationKey,
                } });
                if (existing) {
                    if (existing.delegationHash !== hash) throw new DelegationConflict('Delegation key reused with different content');
                    return { taskId: existing.id, runId: parent.runId, duplicate: true };
                }
                if (execution.status !== 'running' || parent.status !== 'running') {
                    throw new DelegationConflict('Leader execution is not active');
                }
                if (execution.capabilityProtocolVersion > 0 && !body.capability) {
                    throw new DelegationConflict('Delegation capability is required', 403);
                }
                if (body.capability) {
                    try {
                        await assertExecutionCapabilityTx(tx, { accountId,
                            executionId: execution.id, machineId: execution.machineId,
                            token: body.capability, operation: 'delegate' });
                    } catch { throw new DelegationConflict('Delegation capability is unavailable', 403); }
                }
                const team = await tx.aiTeam.findFirst({ where: {
                    id: parent.run.aiWorkItem.teamId, accountId, archivedAt: null,
                }, include: { leader: true, members: { include: { agent: true } } } });
                if (!team || team.leaderId !== parent.assignedAgentId
                    || !(team.leader.settings as { allowDelegation?: boolean }).allowDelegation) {
                    throw new DelegationConflict('Leader is not authorized to delegate', 403);
                }
                const member = team.members.find((item) => item.agentId === body.assignedAgentId)?.agent;
                if (!member || !member.enabled || member.archivedAt) throw new DelegationConflict('Member is unavailable', 403);
                await lockEnabledAgent(tx, accountId, member.id);
                const settings = member.settings as { engine?: string; model?: string; permissionMode?: string;
                    workingDirectory?: string };
                const provider = settings.engine === 'claude-code' ? 'claude' : settings.engine;
                if (provider !== parent.provider || settings.permissionMode === 'approval'
                    || (parent.permissionMode === 'read_only' && settings.permissionMode !== 'read_only')) {
                    throw new DelegationConflict('Member runtime or permission is incompatible');
                }
                const children = await tx.orchestratorTask.findMany({ where: {
                    parentTaskId: id, collaborationRole: 'delegated',
                }, select: { id: true, taskKey: true } });
                if (children.length >= 8) throw new DelegationConflict('Delegation budget exceeded');
                const childIds = new Set(children.map((child) => child.id));
                if (body.dependsOnTaskIds.some((dependency) => !childIds.has(dependency))) {
                    throw new DelegationConflict('Dependency must be an existing sibling task');
                }
                const dependencyKeys = body.dependsOnTaskIds.map((dependency) =>
                    children.find((child) => child.id === dependency)?.taskKey).filter((key): key is string => !!key);
                const aggregate = await tx.orchestratorTask.findFirst({ where: {
                    runId: parent.runId, collaborationRole: 'aggregate', status: 'queued',
                } });
                if (!aggregate) throw new DelegationConflict('Aggregate task is no longer queueable');
                const last = await tx.orchestratorTask.findFirst({ where: { runId: parent.runId },
                    orderBy: { seq: 'desc' }, select: { seq: true } });
                const taskKey = `delegate:${body.delegationKey}`;
                const child = await tx.orchestratorTask.create({ data: {
                    runId: parent.runId, seq: (last?.seq ?? 2) + 1, taskKey, title: body.title,
                    provider: parent.provider, model: settings.model && settings.model !== 'default' ? settings.model : null,
                    prompt: `You are ${member.name}, a member of ${team.name}. Complete only this delegated task.\n\n${body.requirements}`,
                    workingDirectory: parent.workingDirectory,
                    permissionMode: settings.permissionMode, targetMachineId: parent.targetMachineId,
                    baseCommit: parent.baseCommit,
                    parentTaskId: id, assignedAgentId: member.id, delegationKey: body.delegationKey,
                    delegationHash: hash, delegationRequirements: body.requirements,
                    delegationDepth: 1, collaborationRole: 'delegated',
                    dependsOnTaskKeys: dependencyKeys, retryMaxAttempts: 2, retryBackoffMs: 3_000, status: 'queued',
                } });
                const skillBindings = await tx.aiSkillAgentBinding.findMany({ where: {
                    accountId, agentId: member.id, skill: {
                        OR: [{ teamId: null }, { teamId: team.id }], currentVersion: { not: null },
                    },
                }, include: { skill: true } });
                for (const binding of skillBindings) {
                    const version = await tx.aiSkillVersion.findUnique({ where: { skillId_version: {
                        skillId: binding.skillId, version: binding.skill.currentVersion!,
                    } }, select: { contentHash: true, publishedAt: true } });
                    if (version?.publishedAt) await tx.aiTaskSkillSnapshot.create({ data: {
                        taskId: child.id, skillId: binding.skillId, version: binding.skill.currentVersion!,
                        contentHash: version.contentHash,
                    } });
                }
                const moved = await tx.orchestratorTask.updateMany({ where: {
                    id: aggregate.id, status: 'queued', dependsOnTaskKeys: { equals: aggregate.dependsOnTaskKeys },
                }, data: { dependsOnTaskKeys: [...aggregate.dependsOnTaskKeys, taskKey] } });
                if (!moved.count) throw new DelegationConflict('Aggregate changed; retry delegation');
                return { taskId: child.id, runId: parent.runId, duplicate: false };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return reply.code(result.duplicate ? 200 : 201).send(result);
        } catch (error) {
            if (error instanceof DelegationConflict) return reply.code(error.status).send({ error: error.message });
            if (error instanceof Prisma.PrismaClientKnownRequestError
                && (error.code === 'P2002' || error.code === 'P2034')) {
                return reply.code(503).send({ error: 'Delegation is processing; retry with the same key' });
            }
            throw error;
        }
    });

    app.patch('/v1/ai-team/tasks/:id/assignee', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: z.object({
            assignedAgentId: z.string().min(1), reason: z.string().trim().min(1).max(2_000),
        }) },
    }, async (request, reply) => {
        const accountId = request.userId;
        try {
            const result = await db.$transaction(async (tx) => {
                const task = await tx.orchestratorTask.findFirst({ where: { id: request.params.id,
                    run: { accountId } }, include: { run: { include: { aiWorkItem: true } } } });
                if (!task || task.collaborationRole !== 'delegated' || !task.parentTaskId
                    || !task.run.aiWorkItem?.teamId || !task.assignedAgentId) {
                    throw new DelegationConflict('Delegated task not found', 404);
                }
                if (task.status !== 'queued') throw new DelegationConflict('Only queued tasks can be reassigned');
                if (task.assignedAgentId === request.body.assignedAgentId) return { taskId: task.id, duplicate: true };
                const activeExecution = await tx.orchestratorExecution.findFirst({ where: {
                    taskId: task.id, status: { in: ['queued', 'dispatching', 'running'] },
                } });
                if (activeExecution) throw new DelegationConflict('Task already has an execution');
                const member = await tx.aiTeamMember.findFirst({ where: {
                    teamId: task.run.aiWorkItem.teamId, agentId: request.body.assignedAgentId,
                    agent: { accountId, enabled: true, archivedAt: null },
                }, include: { agent: true } });
                if (!member) throw new DelegationConflict('New assignee is not an enabled team member', 403);
                await lockEnabledAgent(tx, accountId, member.agent.id);
                const settings = member.agent.settings as { engine?: string; model?: string; permissionMode?: string;
                    workingDirectory?: string };
                const provider = settings.engine === 'claude-code' ? 'claude' : settings.engine;
                if (provider !== task.provider || settings.permissionMode === 'approval'
                    || (task.permissionMode === 'read_only' && settings.permissionMode !== 'read_only')) {
                    throw new DelegationConflict('New assignee runtime or permission is incompatible');
                }
                const updated = await tx.orchestratorTask.updateMany({ where: { id: task.id,
                    status: 'queued', assignedAgentId: task.assignedAgentId }, data: {
                    assignedAgentId: member.agent.id,
                    model: settings.model && settings.model !== 'default' ? settings.model : null,
                    workingDirectory: task.workingDirectory,
                    permissionMode: settings.permissionMode,
                    prompt: `You are ${member.agent.name}. Complete only this delegated task.\n\n${task.delegationRequirements ?? ''}`,
                } });
                if (!updated.count) throw new DelegationConflict('Task changed; retry');
                await tx.aiDelegationAudit.create({ data: { accountId, taskId: task.id,
                    fromAgentId: task.assignedAgentId, toAgentId: member.agent.id,
                    reason: request.body.reason } });
                return { taskId: task.id, duplicate: false };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return reply.send(result);
        } catch (error) {
            if (error instanceof DelegationConflict) return reply.code(error.status).send({ error: error.message });
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                return reply.code(503).send({ error: 'Reassignment is processing; retry' });
            }
            throw error;
        }
    });
}

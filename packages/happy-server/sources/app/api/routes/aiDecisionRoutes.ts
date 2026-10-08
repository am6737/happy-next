import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/storage/db';
import { safeErrorCode } from '@/app/ai/safeErrorCode';
import { assertExecutionCapabilityTx, ensureOwnerWorkspace } from '@/app/ai/workspaceAuth';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const decision = z.enum(['approved', 'rejected']);

export function aiDecisionRoutes(app: Fastify) {
    app.post('/v1/ai-team/executions/:id/decisions', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            machineId: id, capability: z.string().regex(/^[0-9a-f]{64}$/),
            kind: z.enum(['approval', 'review']),
            operationId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
            actionType: z.string().regex(/^[a-z][a-z0-9._:-]{0,63}$/).optional(),
            actionHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
            summary: z.string().trim().min(1).max(2000),
            expiresAt: z.string().datetime(),
        }).strict().refine((value) => Boolean(value.operationId) === Boolean(value.actionType)
            && Boolean(value.operationId) === Boolean(value.actionHash)
            && (!value.operationId || value.kind === 'approval'),
        { message: 'Operation identity, action type and hash are required together' }) },
    }, async (request, reply) => {
        const expiresAt = new Date(request.body.expiresAt);
        if (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 7 * 86_400_000) {
            return reply.code(400).send({ error: 'Invalid expiry' });
        }
        const workspace = await ensureOwnerWorkspace(request.userId);
        try {
            const row = await db.$transaction(async (tx) => {
                await assertExecutionCapabilityTx(tx, { accountId: request.userId,
                    executionId: request.params.id, machineId: request.body.machineId,
                    token: request.body.capability, operation: 'decision_request' });
                const execution = await tx.orchestratorExecution.findUniqueOrThrow({ where: {
                    id: request.params.id }, include: { run: { include: { aiWorkItem: true } } } });
                const work = execution.run.aiWorkItem;
                if (!work || work.accountId !== request.userId || execution.status !== 'running') {
                    throw new Error('Execution is unavailable');
                }
                if (request.body.operationId && (!execution.childSessionId
                    || !execution.worktreePath || !execution.branchName)) {
                    throw new Error('Operation workspace identity is unavailable');
                }
                const existing = request.body.operationId
                    ? await tx.aiDecisionRequest.findUnique({ where: {
                        executionId_operationId: { executionId: execution.id,
                            operationId: request.body.operationId },
                    } })
                    : await tx.aiDecisionRequest.findFirst({ where: {
                        executionId: execution.id, kind: request.body.kind, operationId: null,
                    } });
                if (existing) {
                    const payload = existing.payload as { summary?: string };
                    if (payload.summary !== request.body.summary
                        || existing.kind !== request.body.kind
                        || existing.actionType !== (request.body.actionType ?? null)
                        || existing.actionHash !== (request.body.actionHash ?? null)
                        || existing.expiresAt.getTime() !== expiresAt.getTime()) {
                        throw new Error('Decision request content conflict');
                    }
                    return existing;
                }
                return tx.aiDecisionRequest.create({ data: {
                    accountId: request.userId, workspaceId: workspace.id,
                    workItemId: work.id, runId: execution.runId,
                    taskId: execution.taskId, executionId: execution.id,
                    machineId: execution.machineId,
                    dispatchTokenHash: createHash('sha256').update(execution.dispatchToken).digest('hex'),
                    operationId: request.body.operationId ?? null,
                    actionType: request.body.actionType ?? null,
                    actionHash: request.body.actionHash ?? null,
                    childSessionId: request.body.operationId ? execution.childSessionId : null,
                    worktreePathHash: request.body.operationId
                        ? createHash('sha256').update(execution.worktreePath!).digest('hex') : null,
                    branchName: request.body.operationId ? execution.branchName : null,
                    kind: request.body.kind, payload: { summary: request.body.summary },
                    expiresAt,
                } });
            });
            return reply.code(201).send({ id: row.id, status: row.status,
                version: row.version, expiresAt: row.expiresAt,
                operationId: row.operationId, actionType: row.actionType,
                actionHash: row.actionHash });
        } catch (error) {
            return reply.code(409).send({ error: error instanceof Error
                ? error.message : 'Decision request unavailable' });
        }
    });

    app.get('/v1/ai-team/decisions', { preHandler: app.authenticate,
        schema: { querystring: z.object({ status: z.enum(['pending', 'decided', 'expired'])
            .optional(), cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) },
    }, async (request, reply) => {
        const memberships = await db.aiWorkspaceMembership.findMany({ where: {
            memberAccountId: request.userId }, select: { workspaceId: true, role: true } });
        const privileged = memberships.filter((item) => item.role === 'owner' || item.role === 'admin')
            .map((item) => item.workspaceId);
        const grants = await db.aiWorkspaceGrant.findMany({ where: {
            memberAccountId: request.userId, canApprove: true,
            workspaceId: { in: memberships.map((item) => item.workspaceId) },
        }, select: { workspaceId: true, resourceKind: true, resourceId: true } });
        const projectIds = grants.filter((grant) => grant.resourceKind === 'project')
            .map((grant) => grant.resourceId);
        const agentIds = grants.filter((grant) => grant.resourceKind === 'agent')
            .map((grant) => grant.resourceId);
        const permittedWork = await db.aiWorkItem.findMany({ where: {
            OR: [{ projectId: { in: projectIds } }, { assigneeId: { in: agentIds } }],
        }, select: { id: true } });
        const rows = await db.aiDecisionRequest.findMany({ where: {
            ...(request.query.status ? { status: request.query.status } : {}),
            OR: [{ workspaceId: { in: privileged } },
                { workItemId: { in: permittedWork.map((work) => work.id) },
                    workspaceId: { in: memberships.map((item) => item.workspaceId) } }],
        }, orderBy: { createdAt: 'desc' }, take: request.query.limit ?? 50,
        ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}) });
        const projection = await db.$transaction(async tx => {
            const workspaceIds = [...new Set(rows.map(row => row.workspaceId))].sort();
            if (!workspaceIds.length) return { items: [], nextCursor: null };
            await tx.$queryRaw`SELECT id FROM "AiWorkspace"
                WHERE id IN (${Prisma.join(workspaceIds)}) ORDER BY id FOR SHARE`;
            const currentMemberships = await tx.aiWorkspaceMembership.findMany({ where: {
                memberAccountId: request.userId, workspaceId: { in: workspaceIds },
            }, select: { workspaceId: true, role: true } });
            const currentRoles = new Map(currentMemberships.map(item =>
                [item.workspaceId, item.role]));
            const currentGrants = await tx.aiWorkspaceGrant.findMany({ where: {
                memberAccountId: request.userId, canApprove: true,
                workspaceId: { in: workspaceIds },
            }, select: { workspaceId: true, resourceKind: true, resourceId: true } });
            const works = await tx.aiWorkItem.findMany({ where: {
                id: { in: rows.map(row => row.workItemId) },
            }, select: { id: true, projectId: true, assigneeId: true } });
            const workById = new Map(works.map(work => [work.id, work]));
            const visible = rows.filter(row => {
                const role = currentRoles.get(row.workspaceId);
                if (role === 'owner' || role === 'admin') return true;
                if (role !== 'member') return false;
                const work = workById.get(row.workItemId);
                if (!work) return false;
                const hasGrant = (kind: string, resourceId: string) => currentGrants.some(grant =>
                    grant.workspaceId === row.workspaceId && grant.resourceKind === kind
                    && grant.resourceId === resourceId);
                return hasGrant('agent', work.assigneeId)
                    && (!work.projectId || hasGrant('project', work.projectId));
            });
            return { items: visible.map(row => ({
                id: row.id, workspaceId: row.workspaceId, workItemId: row.workItemId,
                executionId: row.executionId, kind: row.kind, payload: row.payload,
                operationId: row.operationId, actionType: row.actionType,
                actionHash: row.actionHash,
                status: row.status, version: row.version, expiresAt: row.expiresAt,
                decision: row.decision, decidedAt: row.decidedAt,
                deliveryStatus: row.deliveryStatus,
                errorCode: safeErrorCode(row.errorCode), createdAt: row.createdAt,
            })), nextCursor: visible.length ? rows.at(-1)?.id ?? null : null };
        });
        return reply.send(projection);
    });

    app.post('/v1/ai-team/decisions/:id/respond', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            version: z.number().int().min(1), clientRequestId: id,
            decision, note: z.string().max(2000).default(''),
        }).strict() },
    }, async (request, reply) => {
        try {
            const result = await db.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<Array<{ id: string }>>`
                    SELECT id FROM "AiDecisionRequest" WHERE id=${request.params.id} FOR UPDATE`;
                if (!rows.length) return { code: 404 as const };
                const row = await tx.aiDecisionRequest.findUniqueOrThrow({ where: { id: request.params.id } });
                await tx.$queryRaw`SELECT id FROM "AiWorkspace" WHERE id=${row.workspaceId} FOR UPDATE`;
                const member = await tx.aiWorkspaceMembership.findUnique({ where: {
                    workspaceId_memberAccountId: { workspaceId: row.workspaceId,
                        memberAccountId: request.userId },
                } });
                if (!member) return { code: 404 as const };
                if (member.role === 'member') {
                    const work = await tx.aiWorkItem.findUnique({ where: { id: row.workItemId },
                        select: { projectId: true, assigneeId: true } });
                    const grants = await tx.aiWorkspaceGrant.findMany({ where: {
                        workspaceId: row.workspaceId, memberAccountId: request.userId,
                        canApprove: true,
                    } });
                    const hasGrant = (kind: string, resourceId: string) => grants.some(grant =>
                        grant.resourceKind === kind && grant.resourceId === resourceId);
                    if (!work || !hasGrant('agent', work.assigneeId)
                        || work.projectId && !hasGrant('project', work.projectId)) {
                        return { code: 404 as const };
                    }
                } else if (!['owner', 'admin'].includes(member.role)) return { code: 404 as const };
                if (row.status !== 'pending') {
                    const same = row.decidedBy === request.userId &&
                        row.clientRequestId === request.body.clientRequestId &&
                        row.decision === request.body.decision;
                    return same ? { code: 200 as const, row } : { code: 409 as const };
                }
                if (row.version !== request.body.version || row.expiresAt <= new Date()) {
                    return { code: 409 as const };
                }
                await tx.$queryRaw`SELECT id FROM "OrchestratorExecution"
                    WHERE id=${row.executionId} FOR UPDATE`;
                const execution = await tx.orchestratorExecution.findUnique({ where: {
                    id: row.executionId }, select: { id: true, runId: true, taskId: true,
                        machineId: true, dispatchToken: true, status: true,
                        childSessionId: true, worktreePath: true, branchName: true } });
                if (!execution || execution.status !== 'running' || execution.runId !== row.runId
                    || execution.taskId !== row.taskId || execution.machineId !== row.machineId
                    || createHash('sha256').update(execution.dispatchToken).digest('hex')
                        !== row.dispatchTokenHash || row.operationId && (
                        execution.childSessionId !== row.childSessionId
                        || execution.branchName !== row.branchName
                        || !execution.worktreePath
                        || createHash('sha256').update(execution.worktreePath).digest('hex')
                            !== row.worktreePathHash)) return { code: 409 as const };
                const decided = await tx.aiDecisionRequest.update({ where: { id: row.id },
                    data: { status: 'decided', decision: request.body.decision,
                        note: request.body.note, decidedBy: request.userId,
                        clientRequestId: request.body.clientRequestId, decidedAt: new Date(),
                        version: { increment: 1 }, deliveryStatus: 'pending' } });
                return { code: 200 as const, row: decided };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
            if (!result.row) return reply.code(result.code).send({ error: result.code === 404
                ? 'Decision not found' : 'Decision conflict' });
            return reply.send({ id: result.row.id, status: result.row.status,
                version: result.row.version, deliveryStatus: result.row.deliveryStatus });
        } catch { return reply.code(409).send({ error: 'Decision conflict' }); }
    });
    app.post('/v1/ai-team/decisions/:id/retry', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async (tx) => {
            const row = await tx.aiDecisionRequest.findUnique({ where: { id: request.params.id } });
            if (!row) return { code: 404 as const };
            await tx.$queryRaw`SELECT id FROM "AiWorkspace" WHERE id=${row.workspaceId} FOR UPDATE`;
            const member = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: row.workspaceId,
                    memberAccountId: request.userId },
            }, select: { role: true } });
            if (!member || !['owner', 'admin'].includes(member.role)) return { code: 404 as const };
            await tx.$queryRaw`SELECT id FROM "AiDecisionRequest" WHERE id=${row.id} FOR UPDATE`;
            const current = await tx.aiDecisionRequest.findUniqueOrThrow({ where: { id: row.id } });
            if (current.status !== 'decided') return { code: 409 as const };
            const clock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (current.expiresAt <= clock[0].currentTime) return { code: 409 as const };
            if (current.deliveryStatus === 'pending') return { code: 200 as const };
            if (current.deliveryStatus !== 'blocked') return { code: 409 as const };
            await tx.$queryRaw`SELECT id FROM "OrchestratorExecution"
                WHERE id=${current.executionId} FOR UPDATE`;
            const execution = await tx.orchestratorExecution.findUnique({ where: {
                id: current.executionId }, select: { status: true, runId: true,
                    taskId: true, machineId: true, dispatchToken: true,
                    childSessionId: true, worktreePath: true, branchName: true } });
            if (!execution || execution.status !== 'running' || execution.runId !== current.runId
                || execution.taskId !== current.taskId || execution.machineId !== current.machineId
                || createHash('sha256').update(execution.dispatchToken).digest('hex')
                    !== current.dispatchTokenHash || current.operationId && (
                    execution.childSessionId !== current.childSessionId
                    || execution.branchName !== current.branchName
                    || !execution.worktreePath
                    || createHash('sha256').update(execution.worktreePath).digest('hex')
                        !== current.worktreePathHash)) return { code: 409 as const };
            await tx.aiDecisionRequest.update({ where: { id: row.id }, data: {
                deliveryStatus: 'pending', attempts: 0, claimOwner: null,
                leaseUntil: null, nextAttemptAt: new Date(), errorCode: null,
            } });
            return { code: 200 as const };
        });
        return result.code === 200 ? reply.send({ status: 'pending' })
            : reply.code(result.code).send({ error: result.code === 404
                ? 'Decision not found' : 'Decision cannot be retried' });
    });
}

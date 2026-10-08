import { z } from 'zod';
import { db } from '@/storage/db';
import { authorizeWorkspace } from '@/app/ai/workspaceAuth';
import { recordAiUsageDelta } from '@/app/ai/budget';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const micros = z.string().regex(/^[1-9]\d{0,14}$/);

export function aiBudgetRoutes(app: Fastify) {
    app.put('/v1/ai-team/workspaces/:id/budget', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            projectId: id.nullish(), periodStart: z.string().datetime(),
            periodEnd: z.string().datetime(), limitMicros: micros,
            perRunReserveMicros: micros,
        }).strict() },
    }, async (request, reply) => {
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        const input = request.body;
        const start = new Date(input.periodStart);
        const end = new Date(input.periodEnd);
        if (end <= start || end.getTime() - start.getTime() > 366 * 24 * 60 * 60_000
            || BigInt(input.perRunReserveMicros) > BigInt(input.limitMicros)) {
            return reply.code(400).send({ error: 'Invalid budget period or reserve' });
        }
        if (input.projectId && !await db.aiProject.findFirst({ where: { id: input.projectId,
            accountId: workspace.ownerAccountId }, select: { id: true } })) {
            return reply.code(404).send({ error: 'Project not found' });
        }
        const scopeKey = `${workspace.id}:${input.projectId ?? '*'}:${start.toISOString()}`;
        const policy = await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "AiWorkspace" WHERE id=${workspace.id} FOR UPDATE`;
            const member = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: workspace.id,
                    memberAccountId: request.userId },
            }, select: { role: true } });
            if (!member || !['owner', 'admin'].includes(member.role)) return null;
            const overlap = await tx.aiBudgetPolicy.findFirst({ where: {
                workspaceId: workspace.id, projectId: input.projectId ?? null,
                active: true, periodStart: { lt: end }, periodEnd: { gt: start },
            }, select: { id: true } });
            if (overlap) return null;
            return tx.aiBudgetPolicy.create({ data: { workspaceId: workspace.id,
                scopeKey, projectId: input.projectId ?? null, periodStart: start, periodEnd: end,
                limitMicros: BigInt(input.limitMicros),
                perRunReserveMicros: BigInt(input.perRunReserveMicros) } });
        });
        if (!policy) return reply.code(409).send({ error: 'Budget period overlaps' });
        return reply.code(201).send({ id: policy.id, revision: policy.revision });
    });
    app.get('/v1/ai-team/workspaces/:id/budgets', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        const rows = await db.aiBudgetPolicy.findMany({ where: { workspaceId: workspace.id },
            orderBy: { periodStart: 'desc' }, take: 50 });
        return reply.send({ items: rows.map((row) => ({ id: row.id, projectId: row.projectId,
            periodStart: row.periodStart, periodEnd: row.periodEnd,
            limitMicros: row.limitMicros.toString(), usedMicros: row.usedMicros.toString(),
            reservedMicros: row.reservedMicros.toString(),
            perRunReserveMicros: row.perRunReserveMicros.toString(), revision: row.revision })) });
    });
    app.post('/v1/ai-team/budget-reservations/:id/resolve', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            clientRequestId: id, actualMicros: z.string().regex(/^\d{1,15}$/),
            note: z.string().trim().min(1).max(1000),
        }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async (tx) => {
            const candidate = await tx.aiBudgetReservation.findUnique({ where: {
                id: request.params.id }, include: { policy: true } });
            if (!candidate) return { code: 404 as const };
            await tx.$queryRaw`SELECT id FROM "AiWorkspace" WHERE id=${candidate.policy.workspaceId} FOR UPDATE`;
            const member = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: candidate.policy.workspaceId,
                    memberAccountId: request.userId },
            }, select: { role: true } });
            if (!member || !['owner', 'admin'].includes(member.role)) return { code: 404 as const };
            await tx.$queryRaw`SELECT id FROM "AiBudgetPolicy" WHERE id=${candidate.policyId} FOR UPDATE`;
            const reservation = await tx.aiBudgetReservation.findUniqueOrThrow({ where: {
                id: candidate.id } });
            const actual = BigInt(request.body.actualMicros);
            if (reservation.status === 'settled' && reservation.resolutionRequestId
                === request.body.clientRequestId && reservation.actualMicros === actual
                && reservation.resolutionNote === request.body.note) {
                return { code: 200 as const, id: reservation.id };
            }
            if (reservation.status !== 'unknown') return { code: 409 as const };
            const run = await tx.orchestratorRun.findUnique({ where: { id: reservation.runId },
                select: { status: true } });
            if (!run || !['completed', 'failed', 'cancelled'].includes(run.status)) {
                return { code: 409 as const };
            }
            await tx.aiBudgetReservation.update({ where: { id: reservation.id }, data: {
                status: 'settled', actualMicros: actual, settledAt: new Date(),
                resolutionRequestId: request.body.clientRequestId, resolvedBy: request.userId,
                resolutionNote: request.body.note,
            } });
            await tx.aiBudgetPolicy.update({ where: { id: reservation.policyId }, data: {
                reservedMicros: { decrement: reservation.reserveMicros },
                usedMicros: { increment: actual },
            } });
            return { code: 200 as const, id: reservation.id };
        });
        if (!('id' in result)) return reply.code(result.code).send({ error: result.code === 404
            ? 'Reservation not found' : 'Reservation cannot be resolved' });
        return reply.send({ id: result.id, status: 'settled' });
    });
    app.post('/v1/ai-team/executions/:id/usage-deltas', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            sourceEventId: id, machineId: id, capability: z.string().regex(/^[0-9a-f]{64}$/),
            provider: z.string().min(1).max(100), model: z.string().min(1).max(200),
            inputTokens: z.number().int().nonnegative().max(1_000_000_000),
            outputTokens: z.number().int().nonnegative().max(1_000_000_000),
            costMicros: z.string().regex(/^\d{1,15}$/).nullish(),
            pricingVersion: z.string().max(100).nullish(), measuredAt: z.string().datetime(),
        }).strict() },
    }, async (request, reply) => {
        try {
            const item = await recordAiUsageDelta({ accountId: request.userId,
                executionId: request.params.id, ...request.body,
                costMicros: request.body.costMicros ? BigInt(request.body.costMicros) : null,
                measuredAt: new Date(request.body.measuredAt) });
            return reply.code(item.duplicate ? 200 : 201).send(item);
        } catch (error) {
            return reply.code(409).send({ error: error instanceof Error
                ? error.message : 'Usage event unavailable' });
        }
    });
}

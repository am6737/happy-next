import { z } from 'zod';
import { db } from '@/storage/db';
import { recordExecutionEvent } from '@/app/ai/executionEvents';
import { authorizeWorkItemTx } from '@/app/ai/workspaceAuth';
import { acquireAiDbRead, isAiDbCapacityError, recordAiDbPoolRejection } from '@/app/ai/dbCapacity';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);

export function aiExecutionEventRoutes(app: Fastify) {
    app.post('/v1/ai-team/executions/:id/events', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            eventId: id, seq: z.number().int().min(1),
            kind: z.enum(['status', 'tool', 'result', 'comment']),
            phase: z.string().min(1).max(100), occurredAt: z.string().datetime(),
            summary: z.string().max(8_000), machineId: id,
            capability: z.string().regex(/^[0-9a-f]{64}$/),
        }).strict() },
    }, async (request, reply) => {
        try {
            const result = await recordExecutionEvent({ accountId: request.userId,
                executionId: request.params.id, ...request.body,
                occurredAt: new Date(request.body.occurredAt) });
            return reply.code(result.duplicate ? 200 : 201).send(result);
        } catch (error) {
            return reply.code(409).send({ error: error instanceof Error
                ? error.message : 'Event is unavailable' });
        }
    });
    app.get('/v1/ai-team/executions/:id/events', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            afterSeq: z.coerce.number().int().nonnegative().optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
        }) },
    }, async (request, reply) => {
        const release = acquireAiDbRead();
        if (!release) return reply.header('Retry-After', '2').code(503)
            .send({ errorCode: 'AI_DB_CAPACITY' });
        try {
        const result = await db.$transaction(async tx => {
            const execution = await tx.orchestratorExecution.findUnique({ where: {
                id: request.params.id }, include: { run: { include: {
                    aiWorkItem: { select: { id: true } },
                } } } });
            if (!execution) return null;
            if (execution.run.accountId !== request.userId) {
                const workId = execution.run.aiWorkItem?.id;
                if (!workId || !await authorizeWorkItemTx(tx, {
                    actorAccountId: request.userId, workItemId: workId, operation: 'view',
                })) return null;
            }
            const rows = await tx.aiPersistentExecutionEvent.findMany({ where: {
                executionId: execution.id, accountId: execution.run.accountId,
                seq: { gt: request.query.afterSeq ?? 0 },
            }, orderBy: { seq: 'asc' }, take: request.query.limit ?? 50,
            select: { eventId: true, seq: true, kind: true, phase: true,
                occurredAt: true, redactedSummary: true, redactedAt: true } });
            return { items: rows, nextAfterSeq: rows.at(-1)?.seq
                ?? request.query.afterSeq ?? 0 };
        });
        if (!result) return reply.code(404).send({ error: 'Execution not found' });
        return reply.send(result);
        } catch (error) {
            if (!isAiDbCapacityError(error)) throw error;
            recordAiDbPoolRejection();
            return reply.header('Retry-After', '2').code(503)
                .send({ errorCode: 'AI_DB_CAPACITY' });
        } finally {
            release();
        }
    });
}

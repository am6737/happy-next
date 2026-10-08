import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { authorizeWorkItemTx } from '@/app/ai/workspaceAuth';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const mutationId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const metadataBody = z.object({
    expectedRevision: z.number().int().positive(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    dueDate: z.string().datetime().nullable().optional(),
}).strict().refine(body => body.priority !== undefined || body.labels !== undefined
    || body.dueDate !== undefined);

async function notifySubscribers(tx: Prisma.TransactionClient, input: {
    workItemId: string; actorAccountId: string; eventKey: string;
    action: 'comment_added' | 'metadata_updated';
}) {
    const subscribers = await tx.aiWorkItemSubscription.findMany({ where: {
        workItemId: input.workItemId, actorAccountId: { not: input.actorAccountId },
    }, select: { actorAccountId: true } });
    if (subscribers.length) await tx.aiWorkItemNotification.createMany({
        data: subscribers.map(row => ({ workItemId: input.workItemId,
            recipientAccountId: row.actorAccountId, eventKey: input.eventKey,
            action: input.action, actorAccountId: input.actorAccountId })),
        skipDuplicates: true,
    });
}

export function aiWorkItemCollaborationRoutes(app: Fastify) {
    app.get('/v1/ai-team/work-items/:id/metadata', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'view' });
            if (!access) return null;
            const work = await tx.aiWorkItem.findUnique({ where: { id: access.work.id },
                select: { id: true, priority: true, labels: true, dueDate: true,
                    metadataRevision: true, updatedAt: true } });
            const subscribed = await tx.aiWorkItemSubscription.findUnique({ where: {
                workItemId_actorAccountId: { workItemId: access.work.id,
                    actorAccountId: request.userId },
            }, select: { workItemId: true } });
            return work && { ...work, subscribed: !!subscribed };
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        return reply.send(result);
    });

    app.patch('/v1/ai-team/work-items/:id/metadata', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: metadataBody },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'run' });
            if (!access) return { kind: 'missing' as const };
            await tx.$queryRaw`SELECT id FROM "AiWorkItem"
                WHERE id=${access.work.id} FOR UPDATE`;
            const work = await tx.aiWorkItem.findUniqueOrThrow({ where: { id: access.work.id },
                select: { priority: true, labels: true, dueDate: true,
                    metadataRevision: true } });
            if (work.metadataRevision !== request.body.expectedRevision) {
                return { kind: 'stale' as const };
            }
            const labels = request.body.labels?.map(label => label.trim());
            if (labels && new Set(labels.map(label => label.toLowerCase())).size !== labels.length) {
                return { kind: 'invalid' as const };
            }
            const after = {
                priority: request.body.priority ?? work.priority,
                labels: labels ?? work.labels,
                dueDate: request.body.dueDate === undefined ? work.dueDate
                    : request.body.dueDate === null ? null : new Date(request.body.dueDate),
            };
            const changed = after.priority !== work.priority
                || JSON.stringify(after.labels) !== JSON.stringify(work.labels)
                || after.dueDate?.getTime() !== work.dueDate?.getTime();
            if (!changed) return { kind: 'ok' as const, revision: work.metadataRevision,
                duplicate: true, ...after };
            const updated = await tx.aiWorkItem.update({ where: { id: access.work.id },
                data: { ...after, metadataRevision: { increment: 1 } },
                select: { metadataRevision: true } });
            await tx.aiWorkItemAudit.create({ data: { workItemId: access.work.id,
                actorAccountId: request.userId, action: 'metadata_updated',
                before: { priority: work.priority, labels: work.labels,
                    dueDate: work.dueDate?.toISOString() ?? null },
                after: { priority: after.priority, labels: after.labels,
                    dueDate: after.dueDate?.toISOString() ?? null } } });
            await notifySubscribers(tx, { workItemId: access.work.id,
                actorAccountId: request.userId, eventKey: `metadata:${updated.metadataRevision}`,
                action: 'metadata_updated' });
            return { kind: 'ok' as const, revision: updated.metadataRevision,
                duplicate: false, ...after };
        });
        if (result.kind === 'missing') return reply.code(404).send({ error: 'Work item not found' });
        if (result.kind === 'stale') return reply.code(409).send({ errorCode: 'WORK_ITEM_REVISION_CHANGED' });
        if (result.kind === 'invalid') return reply.code(400).send({ errorCode: 'DUPLICATE_LABEL' });
        return reply.send({ priority: result.priority, labels: result.labels,
            dueDate: result.dueDate, metadataRevision: result.revision,
            duplicate: result.duplicate });
    });

    app.get('/v1/ai-team/work-items/:id/comments', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
        }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'view' });
            if (!access) return null;
            if (request.query.cursor && !await tx.aiWorkItemComment.findFirst({ where: {
                id: request.query.cursor, workItemId: access.work.id }, select: { id: true } })) {
                return { invalidCursor: true as const };
            }
            const rows = await tx.aiWorkItemComment.findMany({ where: {
                workItemId: access.work.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: request.query.limit ?? 50,
            ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}),
            select: { id: true, actorAccountId: true, body: true, createdAt: true } });
            return { items: rows, nextCursor: rows.length === (request.query.limit ?? 50)
                ? rows.at(-1)?.id ?? null : null };
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        if ('invalidCursor' in result) return reply.code(400).send({ errorCode: 'INVALID_CURSOR' });
        return reply.send(result);
    });

    app.post('/v1/ai-team/work-items/:id/comments', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            clientRequestId: mutationId, body: z.string().trim().min(1).max(16_384),
        }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'run' });
            if (!access) return { kind: 'missing' as const };
            const key = { workItemId: access.work.id, actorAccountId: request.userId,
                clientRequestId: request.body.clientRequestId };
            await tx.$queryRaw`SELECT id FROM "AiWorkItem"
                WHERE id=${access.work.id} FOR UPDATE`;
            const existing = await tx.aiWorkItemComment.findUnique({ where: {
                workItemId_actorAccountId_clientRequestId: key } });
            if (existing) return existing.body === request.body.body
                ? { kind: 'ok' as const, comment: existing, duplicate: true }
                : { kind: 'conflict' as const };
            const comment = await tx.aiWorkItemComment.create({ data: {
                ...key, accountId: access.work.accountId, body: request.body.body,
            } });
            await tx.aiWorkItemAudit.create({ data: { workItemId: access.work.id,
                actorAccountId: request.userId, action: 'comment_added',
                after: { commentId: comment.id } } });
            await notifySubscribers(tx, { workItemId: access.work.id,
                actorAccountId: request.userId, eventKey: `comment:${comment.id}`,
                action: 'comment_added' });
            return { kind: 'ok' as const, comment, duplicate: false };
        });
        if (result.kind === 'missing') return reply.code(404).send({ error: 'Work item not found' });
        if (result.kind === 'conflict') return reply.code(409).send({ errorCode: 'COMMENT_ID_CONFLICT' });
        return reply.code(result.duplicate ? 200 : 201).send({ id: result.comment.id,
            actorAccountId: result.comment.actorAccountId, body: result.comment.body,
            createdAt: result.comment.createdAt, duplicate: result.duplicate });
    });

    app.put('/v1/ai-team/work-items/:id/subscription', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'view' });
            if (!access) return null;
            await tx.$queryRaw`SELECT id FROM "AiWorkItem"
                WHERE id=${access.work.id} FOR UPDATE`;
            const key = { workItemId: access.work.id, actorAccountId: request.userId };
            const existing = await tx.aiWorkItemSubscription.findUnique({ where: {
                workItemId_actorAccountId: key } });
            if (!existing) {
                await tx.aiWorkItemSubscription.create({ data: key });
                await tx.aiWorkItemAudit.create({ data: { workItemId: access.work.id,
                    actorAccountId: request.userId, action: 'subscribed' } });
            }
            return { subscribed: true, duplicate: !!existing };
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        return reply.send(result);
    });

    app.delete('/v1/ai-team/work-items/:id/subscription', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'view' });
            if (!access) return null;
            await tx.$queryRaw`SELECT id FROM "AiWorkItem"
                WHERE id=${access.work.id} FOR UPDATE`;
            const removed = await tx.aiWorkItemSubscription.deleteMany({ where: {
                workItemId: access.work.id, actorAccountId: request.userId } });
            if (removed.count) await tx.aiWorkItemAudit.create({ data: {
                workItemId: access.work.id, actorAccountId: request.userId,
                action: 'unsubscribed',
            } });
            return { subscribed: false, duplicate: removed.count === 0 };
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        return reply.send(result);
    });

    app.get('/v1/ai-team/notifications', { preHandler: app.authenticate,
        schema: { querystring: z.object({ cursor: id.optional(),
            limit: z.coerce.number().int().min(1).max(100).optional() }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            if (request.query.cursor && !await tx.aiWorkItemNotification.findFirst({ where: {
                id: request.query.cursor, recipientAccountId: request.userId,
            }, select: { id: true } })) return null;
            const take = request.query.limit ?? 50;
            const rows = await tx.aiWorkItemNotification.findMany({ where: {
                recipientAccountId: request.userId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take,
            ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}),
            select: { id: true, workItemId: true, action: true,
                actorAccountId: true, createdAt: true, readAt: true } });
            const items = [] as typeof rows;
            for (const row of rows) {
                if (await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                    workItemId: row.workItemId, operation: 'view' })) items.push(row);
            }
            return { items, nextCursor: rows.length === take ? rows.at(-1)?.id ?? null : null };
        });
        if (!result) return reply.code(400).send({ errorCode: 'INVALID_CURSOR' });
        return reply.send(result);
    });

    app.post('/v1/ai-team/notifications/:id/read', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const row = await tx.aiWorkItemNotification.findFirst({ where: {
                id: request.params.id, recipientAccountId: request.userId,
            }, select: { id: true, workItemId: true, readAt: true } });
            if (!row || !await authorizeWorkItemTx(tx, {
                actorAccountId: request.userId, workItemId: row.workItemId,
                operation: 'view',
            })) return null;
            if (!row.readAt) await tx.aiWorkItemNotification.updateMany({ where: {
                id: row.id, recipientAccountId: request.userId, readAt: null,
            }, data: { readAt: new Date() } });
            return { id: row.id, read: true };
        });
        if (!result) return reply.code(404).send({ error: 'Notification not found' });
        return reply.send(result);
    });

    app.get('/v1/ai-team/work-items/:id/audit', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
        }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const access = await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                workItemId: request.params.id, operation: 'view' });
            if (!access) return null;
            if (request.query.cursor && !await tx.aiWorkItemAudit.findFirst({ where: {
                id: request.query.cursor, workItemId: access.work.id }, select: { id: true } })) {
                return { invalidCursor: true as const };
            }
            const rows = await tx.aiWorkItemAudit.findMany({ where: {
                workItemId: access.work.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: request.query.limit ?? 50,
            ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}),
            select: { id: true, actorAccountId: true, action: true,
                before: true, after: true, createdAt: true } });
            return { items: rows, nextCursor: rows.length === (request.query.limit ?? 50)
                ? rows.at(-1)?.id ?? null : null };
        });
        if (!result) return reply.code(404).send({ error: 'Work item not found' });
        if ('invalidCursor' in result) return reply.code(400).send({ errorCode: 'INVALID_CURSOR' });
        return reply.send(result);
    });
}

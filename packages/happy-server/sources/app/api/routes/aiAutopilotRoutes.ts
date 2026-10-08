import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { db } from '@/storage/db';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const inputSchema = z.object({
    projectId: id, agentId: id, teamId: id.optional(),
    name: z.string().trim().min(1).max(200), prompt: z.string().trim().min(1).max(12_000),
    triggerKind: z.enum(['cron', 'manual', 'webhook']),
    cronExpression: z.string().min(1).max(100).optional(),
    timezone: z.string().min(1).max(100).optional(),
    action: z.enum(['create_issue', 'run_only']),
    concurrencyPolicy: z.enum(['skip', 'queue', 'replace']),
    catchupLimit: z.number().int().min(1).max(24).default(1),
}).strict();

function validCron(expression: string, timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        CronExpressionParser.parse(expression, { tz: timezone }).next().toDate();
        return true;
    } catch { return false; }
}

export function aiAutopilotRoutes(app: Fastify) {
    app.get('/v1/ai-team/autopilots', { preHandler: app.authenticate }, async (request, reply) => {
        const rows = await db.aiAutopilot.findMany({ where: { accountId: request.userId },
            orderBy: { updatedAt: 'desc' }, take: 100,
            select: { id: true, name: true, projectId: true, agentId: true, teamId: true,
                triggerKind: true, cronExpression: true, timezone: true, action: true,
                concurrencyPolicy: true, catchupLimit: true, enabled: true, updatedAt: true } });
        return reply.send({ items: rows });
    });
    app.post('/v1/ai-team/autopilots', { preHandler: app.authenticate,
        schema: { body: inputSchema },
    }, async (request, reply) => {
        const input = request.body;
        if (input.triggerKind === 'cron' && (!input.cronExpression || !input.timezone
            || !validCron(input.cronExpression, input.timezone))) {
            return reply.code(400).send({ error: 'Valid cron expression and IANA timezone are required' });
        }
        if (input.triggerKind !== 'cron' && (input.cronExpression || input.timezone)) {
            return reply.code(400).send({ error: 'Cron fields require cron trigger' });
        }
        const [project, agent, team] = await Promise.all([
            db.aiProject.findFirst({ where: { id: input.projectId, accountId: request.userId,
                active: true }, select: { id: true, currentVersion: true,
                versions: { orderBy: { version: 'desc' }, take: 1,
                    select: { kind: true } } } }),
            db.aiAgent.findFirst({ where: { id: input.agentId, accountId: request.userId,
                enabled: true, archivedAt: null }, select: { id: true } }),
            input.teamId ? db.aiTeam.findFirst({ where: { id: input.teamId,
                accountId: request.userId, archivedAt: null,
                members: { some: { agentId: input.agentId } } }, select: { id: true, leaderId: true } }) : null,
        ]);
        if (!project || !agent || input.teamId && (!team || team.leaderId !== agent.id)) {
            return reply.code(403).send({ error: 'Project or assignee is unavailable' });
        }
        if (project.versions[0]?.kind === 'local' && input.action !== 'run_only') {
            return reply.code(400).send({ error: 'Local projects only support run_only' });
        }
        const autopilotId = randomUUID();
        const secret = input.triggerKind === 'webhook' ? randomBytes(32) : null;
        const created = await db.$transaction(async (tx) => {
            const conversation = await tx.aiConversation.create({ data: { accountId: request.userId,
                agentId: agent.id, teamId: team?.id ?? null,
                scopeKey: `autopilot:${autopilotId}`, kind: team ? 'group' : 'direct', title: input.name } });
            return tx.aiAutopilot.create({ data: { id: autopilotId, accountId: request.userId,
                projectId: project.id, agentId: agent.id, teamId: team?.id ?? null,
                conversationId: conversation.id, name: input.name, prompt: input.prompt,
                triggerKind: input.triggerKind, cronExpression: input.cronExpression,
                timezone: input.timezone, webhookSecret: secret,
                action: input.action, concurrencyPolicy: input.concurrencyPolicy,
                catchupLimit: input.catchupLimit, enabled: false } });
        });
        return reply.code(201).send({ id: created.id, enabled: false,
            ...(secret ? { webhookSecret: secret.toString('hex') } : {}) });
    });
    app.patch('/v1/ai-team/autopilots/:id/status', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ enabled: z.boolean() }) },
    }, async (request, reply) => {
        const row = await db.aiAutopilot.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { enabled: true, projectId: true, action: true } });
        if (!row) return reply.code(404).send({ error: 'Autopilot not found' });
        const project = request.body.enabled ? await db.aiProject.findFirst({ where: { id: row.projectId,
            accountId: request.userId, active: true }, select: { id: true,
            versions: { orderBy: { version: 'desc' }, take: 1, select: { kind: true } } } }) : null;
        if (request.body.enabled && !project) {
            return reply.code(409).send({ error: 'Project is inactive' });
        }
        if (project?.versions[0]?.kind === 'local' && row.action !== 'run_only') {
            return reply.code(409).send({ error: 'Local projects only support run_only' });
        }
        await db.$transaction(async (tx) => {
            await tx.aiAutopilot.updateMany({ where: { id: request.params.id,
                accountId: request.userId }, data: { enabled: request.body.enabled,
                ...(request.body.enabled && !row.enabled ? { lastPlannedAt: new Date() } : {}) } });
            if (!request.body.enabled) await tx.aiAutopilotRun.updateMany({ where: {
                autopilotId: request.params.id, status: 'pending',
            }, data: { status: 'skipped', errorCode: 'disabled' } });
        });
        return reply.send({ enabled: request.body.enabled });
    });
    app.post('/v1/ai-team/autopilots/:id/run', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ clientRequestId: z.string()
            .regex(/^[A-Za-z0-9._:-]{1,128}$/) }) },
    }, async (request, reply) => {
        const autopilot = await db.aiAutopilot.findFirst({ where: { id: request.params.id,
            accountId: request.userId, enabled: true }, select: { id: true } });
        if (!autopilot) return reply.code(404).send({ error: 'Enabled autopilot not found' });
        const triggerKey = `manual:${request.body.clientRequestId}`;
        const run = await db.aiAutopilotRun.upsert({ where: { autopilotId_triggerKey: {
            autopilotId: autopilot.id, triggerKey,
        } }, create: { autopilotId: autopilot.id, triggerKey, plannedAt: new Date() }, update: {} });
        return reply.code(202).send({ id: run.id, status: run.status });
    });
    app.post('/v1/ai-team/autopilots/:id/webhook', {
        schema: { params: z.object({ id }), body: z.object({
            deliveryId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
            timestamp: z.number().int(), payloadBase64: z.string().max(45_000),
            signature: z.string().regex(/^[0-9a-f]{64}$/i),
        }) },
    }, async (request, reply) => {
        const autopilot = await db.aiAutopilot.findFirst({ where: { id: request.params.id,
            enabled: true, triggerKind: 'webhook' }, select: { id: true, webhookSecret: true } });
        if (!autopilot?.webhookSecret || Math.abs(Date.now() - request.body.timestamp) > 5 * 60_000) {
            return reply.code(401).send({ error: 'Invalid webhook signature' });
        }
        const raw = Buffer.from(request.body.payloadBase64, 'base64');
        if (raw.length > 32_000) return reply.code(413).send({ error: 'Webhook payload too large' });
        const expected = createHmac('sha256', autopilot.webhookSecret)
            .update(`${request.body.timestamp}.${request.body.deliveryId}.`).update(raw).digest();
        const actual = Buffer.from(request.body.signature, 'hex');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            return reply.code(401).send({ error: 'Invalid webhook signature' });
        }
        const triggerKey = `webhook:${request.body.deliveryId}`;
        const payloadHash = createHash('sha256').update(raw).digest('hex');
        const run = await db.aiAutopilotRun.upsert({ where: { autopilotId_triggerKey: {
            autopilotId: autopilot.id, triggerKey,
        } }, create: { autopilotId: autopilot.id, triggerKey, payloadHash, plannedAt: new Date() }, update: {} });
        if (run.payloadHash !== payloadHash) {
            return reply.code(409).send({ error: 'Webhook delivery content conflict' });
        }
        return reply.code(202).send({ id: run.id, status: run.status });
    });
    app.get('/v1/ai-team/autopilots/:id/runs', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const autopilot = await db.aiAutopilot.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true } });
        if (!autopilot) return reply.code(404).send({ error: 'Autopilot not found' });
        const rows = await db.aiAutopilotRun.findMany({ where: { autopilotId: autopilot.id },
            orderBy: { plannedAt: 'desc' }, take: 100,
            select: { id: true, triggerKey: true, plannedAt: true, status: true,
                attempts: true, errorCode: true, orchestratorRunId: true,
                workItemId: true, issueResourceId: true } });
        return reply.send({ items: rows });
    });
}

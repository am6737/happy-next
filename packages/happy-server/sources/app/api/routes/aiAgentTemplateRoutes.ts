import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/storage/db';
import { AiAgentTemplateContentSchema, AiExecutionTemplateContextSchema,
    AiExecutionTemplateProposalInputSchema, AiAgentTemplateProposalInputSchema,
    AiAgentTemplateReviewInputSchema } from 'happy-wire';
import { assertExecutionCapabilityTx } from '@/app/ai/workspaceAuth';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const contentSchema = AiAgentTemplateContentSchema;

function hashContent(content: z.infer<typeof contentSchema>) {
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

async function projectProposalSources<T extends { sourceExecutionId: string | null;
    sourceAgentId: string | null }>(accountId: string, templateId: string, items: T[]) {
    const sourceIds = items.flatMap(item => item.sourceExecutionId ? [item.sourceExecutionId] : []);
    const executions = sourceIds.length ? await db.orchestratorExecution.findMany({ where: {
        id: { in: sourceIds }, run: { accountId }, templateVersionId: { not: null },
    }, select: { id: true, templateVersionId: true,
        task: { select: { assignedAgentId: true } },
        run: { select: { aiWorkItem: { select: { assigneeId: true } } } },
    } }) : [];
    const versionIds = executions.flatMap(item => item.templateVersionId
        ? [item.templateVersionId] : []);
    const versions = versionIds.length ? await db.aiAgentTemplateVersion.findMany({ where: {
        id: { in: versionIds }, templateId,
        template: { accountId }, publishedAt: { not: null },
    }, select: { id: true, version: true, contentHash: true, content: true } }) : [];
    const executionById = new Map(executions.map(item => [item.id, item]));
    const versionById = new Map(versions.map(item => [item.id, item]));
    return items.map(item => {
        const execution = item.sourceExecutionId
            ? executionById.get(item.sourceExecutionId) : null;
        const version = execution?.templateVersionId
            ? versionById.get(execution.templateVersionId) : null;
        const sourceAgentId = execution?.task.assignedAgentId
            ?? execution?.run.aiWorkItem?.assigneeId;
        const content = version ? contentSchema.safeParse(version.content) : null;
        const frozen = execution && sourceAgentId === item.sourceAgentId && version
            && content?.success && hashContent(content.data) === version.contentHash
            ? version : null;
        return { ...item, frozenVersion: frozen?.version ?? null,
            frozenContentHash: frozen?.contentHash ?? null,
            frozenContent: frozen?.content ?? null };
    });
}

async function loadTemplateProposalScopeTx(tx: Prisma.TransactionClient, input: {
    accountId: string; executionId: string; machineId: string;
    dispatchToken: string; capability: string; allowDispatching?: boolean;
}) {
    await assertExecutionCapabilityTx(tx, { token: input.capability,
        accountId: input.accountId, executionId: input.executionId,
        machineId: input.machineId, operation: 'template_propose' });
    const execution = await tx.orchestratorExecution.findFirst({ where: {
        id: input.executionId, machineId: input.machineId,
        dispatchToken: input.dispatchToken,
        status: input.allowDispatching ? { in: ['dispatching', 'running'] } : 'running',
        capabilityProtocolVersion: 1, run: { accountId: input.accountId },
    }, include: { task: { select: { assignedAgentId: true } },
        run: { include: { aiWorkItem: { select: { assigneeId: true } } } } } });
    if (!execution?.templateVersionId || !execution.run.aiWorkItem) return null;
    const latest = await tx.orchestratorExecution.findFirst({ where: {
        taskId: execution.taskId }, orderBy: { attempt: 'desc' },
    select: { id: true } });
    if (latest?.id !== execution.id) return null;
    const sourceAgentId = execution.task.assignedAgentId
        ?? execution.run.aiWorkItem.assigneeId;
    const pinned = await tx.aiAgentTemplateVersion.findFirst({ where: {
        id: execution.templateVersionId, template: { accountId: input.accountId },
    }, select: { templateId: true, version: true, contentHash: true,
        content: true, publishedAt: true } });
    if (!pinned?.publishedAt) return null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AiAgentTemplate"
        WHERE id=${pinned.templateId} AND "accountId"=${input.accountId}
        FOR UPDATE`;
    if (!locked.length) return null;
    await tx.$queryRaw`SELECT id FROM "AiAgent"
        WHERE id=${sourceAgentId} AND "accountId"=${input.accountId} FOR SHARE`;
    const agent = await tx.aiAgent.findFirst({ where: {
        id: sourceAgentId, accountId: input.accountId, enabled: true,
        archivedAt: null, templateVersionId: execution.templateVersionId,
    }, select: { id: true } });
    if (!agent) return null;
    const template = await tx.aiAgentTemplate.findUniqueOrThrow({ where: {
        id: pinned.templateId }, select: { currentVersion: true } });
    const current = await tx.aiAgentTemplateVersion.findUnique({ where: {
        templateId_version: { templateId: pinned.templateId,
            version: template.currentVersion },
    }, select: { version: true, contentHash: true, content: true, publishedAt: true } });
    if (!current?.publishedAt) return null;
    const frozenContent = contentSchema.safeParse(pinned.content);
    const currentContent = contentSchema.safeParse(current.content);
    if (!frozenContent.success || !currentContent.success
        || hashContent(frozenContent.data) !== pinned.contentHash
        || hashContent(currentContent.data) !== current.contentHash) return null;
    return { execution, sourceAgentId, templateId: pinned.templateId,
        frozen: { ...pinned, content: frozenContent.data },
        current: { ...current, content: currentContent.data } };
}

export function aiAgentTemplateRoutes(app: Fastify) {
    app.get('/v1/ai-team/agents/:agentId/template-source', { preHandler: app.authenticate,
        schema: { params: z.object({ agentId: id }) },
    }, async (request, reply) => {
        const agent = await db.aiAgent.findFirst({ where: { id: request.params.agentId,
            accountId: request.userId, archivedAt: null },
        select: { templateVersion: { select: { version: true, contentHash: true,
            template: { select: { id: true, name: true, currentVersion: true } } } } } });
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
        const version = agent.templateVersion;
        return reply.send({ source: version ? { templateId: version.template.id,
            templateName: version.template.name, version: version.version,
            contentHash: version.contentHash,
            current: version.template.currentVersion === version.version } : null });
    });

    app.get('/v1/ai-team/agent-templates', { preHandler: app.authenticate }, async (request, reply) => {
        const rows = await db.aiAgentTemplate.findMany({ where: { accountId: request.userId },
            orderBy: { updatedAt: 'desc' }, take: 100,
            include: { versions: { select: { version: true, contentHash: true,
                publishedAt: true }, orderBy: { version: 'desc' } } } });
        return reply.send({ items: rows });
    });

    app.post('/v1/ai-team/agent-templates', { preHandler: app.authenticate,
        schema: { body: z.object({ name: z.string().trim().min(1).max(100),
            content: contentSchema }).strict() },
    }, async (request, reply) => {
        const content = request.body.content;
        try {
            const row = await db.aiAgentTemplate.create({ data: {
                accountId: request.userId, name: request.body.name,
                versions: { create: { version: 1, contentHash: hashContent(content),
                    content: content as Prisma.InputJsonValue } },
            }, include: { versions: true } });
            return reply.code(201).send({ id: row.id, version: 1,
                contentHash: row.versions[0].contentHash, status: 'draft' });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_NAME_EXISTS' });
            }
            throw error;
        }
    });

    app.get('/v1/ai-team/agent-templates/:id', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const row = await db.aiAgentTemplate.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, include: { versions: { orderBy: { version: 'desc' },
            select: { version: true, contentHash: true, publishedAt: true, createdAt: true } } } });
        if (!row) return reply.code(404).send({ error: 'Agent template not found' });
        return reply.send(row);
    });

    app.get('/v1/ai-team/agent-templates/:id/versions/:version', { preHandler: app.authenticate,
        schema: { params: z.object({ id, version: z.coerce.number().int().positive() }) },
    }, async (request, reply) => {
        const row = await db.aiAgentTemplateVersion.findFirst({ where: {
            templateId: request.params.id, version: request.params.version,
            template: { accountId: request.userId },
        }, select: { id: true, version: true, contentHash: true, content: true,
            publishedAt: true, createdAt: true, template: { select: { currentVersion: true } } } });
        if (!row) return reply.code(404).send({ error: 'Agent template version not found' });
        return reply.send({ version: row.version, contentHash: row.contentHash,
            content: row.content, publishedAt: row.publishedAt,
            current: row.template.currentVersion === row.version, createdAt: row.createdAt });
    });

    app.get('/v1/ai-team/agent-templates/:id/proposals', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            status: z.enum(['pending', 'accepted', 'rejected']).optional(),
        }) },
    }, async (request, reply) => {
        const template = await db.aiAgentTemplate.findFirst({ where: {
            id: request.params.id, accountId: request.userId }, select: { id: true } });
        if (!template) return reply.code(404).send({ error: 'Agent template not found' });
        const items = await db.aiAgentTemplateProposal.findMany({ where: {
            templateId: template.id, ...(request.query.status ? { status: request.query.status } : {}),
        }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
        select: { id: true, actorAccountId: true, sourceAgentId: true,
            sourceExecutionId: true,
            expectedCurrentVersion: true, contentHash: true, content: true,
            note: true, status: true, reviewedByAccountId: true, reviewedAt: true,
            publishedVersion: true, createdAt: true } });
        return reply.send({ items: await projectProposalSources(request.userId,
            template.id, items) });
    });

    app.get('/v1/ai-team/agent-templates/:id/proposals/:proposalId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id, proposalId: id }) },
    }, async (request, reply) => {
        const template = await db.aiAgentTemplate.findFirst({ where: {
            id: request.params.id, accountId: request.userId }, select: { id: true } });
        if (!template) return reply.code(404).send({ error: 'Proposal not found' });
        const proposal = await db.aiAgentTemplateProposal.findFirst({ where: {
            id: request.params.proposalId, templateId: template.id,
        }, select: { id: true, actorAccountId: true, sourceAgentId: true,
            sourceExecutionId: true, expectedCurrentVersion: true,
            contentHash: true, content: true, note: true, status: true,
            reviewedByAccountId: true, reviewedAt: true,
            publishedVersion: true, createdAt: true } });
        if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
        const [item] = await projectProposalSources(request.userId, template.id, [proposal]);
        return reply.send(item);
    });

    app.post('/v1/ai-team/executions/:executionId/template-proposals/context', {
        preHandler: app.authenticate,
        schema: { params: z.object({ executionId: id }), body: z.object({
            machineId: id, dispatchToken: z.string().min(1),
            capability: z.string().regex(/^[0-9a-f]{64}$/),
        }).strict() },
    }, async (request, reply) => {
        try {
            const result = await db.$transaction(async tx => {
                const scope = await loadTemplateProposalScopeTx(tx, {
                    accountId: request.userId, executionId: request.params.executionId,
                    machineId: request.body.machineId,
                    dispatchToken: request.body.dispatchToken,
                    capability: request.body.capability,
                    allowDispatching: true,
                });
                if (!scope) return null;
                return AiExecutionTemplateContextSchema.parse({ templateId: scope.templateId,
                    sourceAgentId: scope.sourceAgentId,
                    sourceExecutionId: scope.execution.id,
                    frozenVersion: scope.frozen.version,
                    frozenContentHash: scope.frozen.contentHash,
                    frozenContent: scope.frozen.content,
                    currentVersion: scope.current.version,
                    currentContentHash: scope.current.contentHash,
                    currentContent: scope.current.content });
            });
            if (!result) return reply.code(409).send({ errorCode: 'TEMPLATE_PROPOSAL_SCOPE_INVALID' });
            return reply.send(result);
        } catch {
            return reply.code(409).send({ errorCode: 'TEMPLATE_PROPOSAL_SCOPE_INVALID' });
        }
    });

    app.post('/v1/ai-team/executions/:executionId/template-proposals', {
        preHandler: app.authenticate,
        schema: { params: z.object({ executionId: id }),
            body: AiExecutionTemplateProposalInputSchema },
    }, async (request, reply) => {
        const contentHash = hashContent(request.body.content);
        try {
            const result = await db.$transaction(async tx => {
                const scope = await loadTemplateProposalScopeTx(tx, {
                    accountId: request.userId, executionId: request.params.executionId,
                    machineId: request.body.machineId,
                    dispatchToken: request.body.dispatchToken,
                    capability: request.body.capability,
                });
                if (!scope || scope.templateId !== request.body.templateId) {
                    return { kind: 'unavailable' as const };
                }
                const key = { templateId: request.body.templateId,
                    actorAccountId: request.userId,
                    clientRequestId: `execution:${scope.execution.id}:${request.body.clientRequestId}` };
                const existing = await tx.aiAgentTemplateProposal.findUnique({ where: {
                    templateId_actorAccountId_clientRequestId: key } });
                if (existing) return existing.contentHash === contentHash
                    && existing.note === request.body.note
                    && existing.sourceAgentId === scope.sourceAgentId
                    && existing.sourceExecutionId === scope.execution.id
                    && existing.expectedCurrentVersion === request.body.expectedCurrentVersion
                    ? { kind: 'ok' as const, proposal: existing, duplicate: true }
                    : { kind: 'conflict' as const };
                if (scope.current.version !== request.body.expectedCurrentVersion) {
                    return { kind: 'stale' as const };
                }
                const proposal = await tx.aiAgentTemplateProposal.create({ data: {
                    ...key, sourceAgentId: scope.sourceAgentId,
                    sourceExecutionId: scope.execution.id,
                    expectedCurrentVersion: request.body.expectedCurrentVersion,
                    contentHash, content: request.body.content as Prisma.InputJsonValue,
                    note: request.body.note,
                } });
                return { kind: 'ok' as const, proposal, duplicate: false };
            });
            if (result.kind === 'unavailable') return reply.code(409).send({ errorCode: 'TEMPLATE_PROPOSAL_SCOPE_INVALID' });
            if (result.kind === 'stale') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_VERSION_CHANGED' });
            if (result.kind === 'conflict') return reply.code(409).send({ errorCode: 'PROPOSAL_ID_CONFLICT' });
            return reply.code(result.duplicate ? 200 : 201).send({ id: result.proposal.id,
                status: result.proposal.status, contentHash, duplicate: result.duplicate });
        } catch {
            return reply.code(409).send({ errorCode: 'TEMPLATE_PROPOSAL_SCOPE_INVALID' });
        }
    });

    app.post('/v1/ai-team/agent-templates/:id/proposals', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: AiAgentTemplateProposalInputSchema },
    }, async (request, reply) => {
        const contentHash = hashContent(request.body.content);
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgentTemplate" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} FOR UPDATE`;
            if (!locked.length) return { kind: 'missing' as const };
            const key = { templateId: request.params.id, actorAccountId: request.userId,
                clientRequestId: request.body.clientRequestId };
            const existing = await tx.aiAgentTemplateProposal.findUnique({ where: {
                templateId_actorAccountId_clientRequestId: key } });
            if (existing) return existing.contentHash === contentHash
                && existing.note === request.body.note
                && existing.sourceAgentId === (request.body.sourceAgentId ?? null)
                && existing.expectedCurrentVersion === request.body.expectedCurrentVersion
                ? { kind: 'ok' as const, proposal: existing, duplicate: true }
                : { kind: 'conflict' as const };
            if (request.body.sourceAgentId && !await tx.aiAgent.findFirst({ where: {
                id: request.body.sourceAgentId, accountId: request.userId, archivedAt: null,
            }, select: { id: true } })) return { kind: 'missing' as const };
            const template = await tx.aiAgentTemplate.findUniqueOrThrow({ where: {
                id: request.params.id }, select: { currentVersion: true } });
            if (template.currentVersion !== request.body.expectedCurrentVersion) {
                return { kind: 'stale' as const };
            }
            const proposal = await tx.aiAgentTemplateProposal.create({ data: {
                ...key, sourceAgentId: request.body.sourceAgentId ?? null,
                expectedCurrentVersion: request.body.expectedCurrentVersion,
                contentHash, content: request.body.content as Prisma.InputJsonValue,
                note: request.body.note,
            } });
            return { kind: 'ok' as const, proposal, duplicate: false };
        });
        if (result.kind === 'missing') return reply.code(404).send({ error: 'Agent template or source not found' });
        if (result.kind === 'stale') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_VERSION_CHANGED' });
        if (result.kind === 'conflict') return reply.code(409).send({ errorCode: 'PROPOSAL_ID_CONFLICT' });
        return reply.code(result.duplicate ? 200 : 201).send({ id: result.proposal.id,
            status: result.proposal.status, contentHash, duplicate: result.duplicate });
    });

    app.post('/v1/ai-team/agent-templates/:id/proposals/:proposalId/review', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id, proposalId: id }),
            body: AiAgentTemplateReviewInputSchema },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgentTemplate" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} FOR UPDATE`;
            if (!locked.length) return { kind: 'missing' as const };
            const proposal = await tx.aiAgentTemplateProposal.findFirst({ where: {
                id: request.params.proposalId, templateId: request.params.id } });
            if (!proposal) return { kind: 'missing' as const };
            if (proposal.status !== 'pending') return proposal.status === request.body.decision
                ? { kind: 'ok' as const, version: proposal.publishedVersion, duplicate: true }
                : { kind: 'conflict' as const };
            const template = await tx.aiAgentTemplate.findUniqueOrThrow({ where: {
                id: request.params.id } });
            if (template.currentVersion !== request.body.expectedCurrentVersion
                || proposal.expectedCurrentVersion !== request.body.expectedCurrentVersion) {
                return { kind: 'stale' as const };
            }
            let version: number | null = null;
            if (request.body.decision === 'accepted') {
                const latest = await tx.aiAgentTemplateVersion.findFirst({ where: {
                    templateId: template.id }, orderBy: { version: 'desc' },
                    select: { version: true } });
                version = (latest?.version ?? 0) + 1;
                await tx.aiAgentTemplateVersion.create({ data: {
                    templateId: template.id, version, contentHash: proposal.contentHash,
                    content: proposal.content as Prisma.InputJsonValue, publishedAt: new Date(),
                } });
                await tx.aiAgentTemplate.update({ where: { id: template.id },
                    data: { currentVersion: version } });
            }
            await tx.aiAgentTemplateProposal.update({ where: { id: proposal.id }, data: {
                status: request.body.decision, reviewedByAccountId: request.userId,
                reviewedAt: new Date(), publishedVersion: version,
            } });
            return { kind: 'ok' as const, version, duplicate: false };
        });
        if (result.kind === 'missing') return reply.code(404).send({ error: 'Proposal not found' });
        if (result.kind === 'stale') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_VERSION_CHANGED' });
        if (result.kind === 'conflict') return reply.code(409).send({ errorCode: 'PROPOSAL_ALREADY_REVIEWED' });
        return reply.send({ status: request.body.decision, publishedVersion: result.version,
            duplicate: result.duplicate });
    });

    app.post('/v1/ai-team/agent-templates/:id/versions', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ content: contentSchema }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgentTemplate" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} FOR UPDATE`;
            if (!locked.length) return null;
            const latest = await tx.aiAgentTemplateVersion.findFirst({ where: {
                templateId: request.params.id }, orderBy: { version: 'desc' },
                select: { version: true } });
            const version = (latest?.version ?? 0) + 1;
            const row = await tx.aiAgentTemplateVersion.create({ data: {
                templateId: request.params.id, version,
                contentHash: hashContent(request.body.content),
                content: request.body.content as Prisma.InputJsonValue,
            } });
            return { version, contentHash: row.contentHash };
        });
        if (!result) return reply.code(404).send({ error: 'Agent template not found' });
        return reply.code(201).send({ ...result, status: 'draft' });
    });

    app.post('/v1/ai-team/agent-templates/:id/versions/:version/publish', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id, version: z.coerce.number().int().positive() }),
            body: z.object({ confirmed: z.literal(true) }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgentTemplate" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} FOR UPDATE`;
            if (!locked.length) return 'missing' as const;
            const version = await tx.aiAgentTemplateVersion.findUnique({ where: {
                templateId_version: { templateId: request.params.id,
                    version: request.params.version },
            } });
            if (!version) return 'missing' as const;
            const template = await tx.aiAgentTemplate.findUniqueOrThrow({
                where: { id: request.params.id } });
            if (version.publishedAt) return template.currentVersion === version.version
                ? 'ok' as const : 'stale' as const;
            const latest = await tx.aiAgentTemplateVersion.findFirst({ where: {
                templateId: template.id }, orderBy: { version: 'desc' }, select: { id: true } });
            if (latest?.id !== version.id) return 'stale' as const;
            if (!version.publishedAt) await tx.aiAgentTemplateVersion.update({
                where: { id: version.id }, data: { publishedAt: new Date() },
            });
            await tx.aiAgentTemplate.update({ where: { id: request.params.id },
                data: { currentVersion: version.version } });
            return 'ok' as const;
        });
        if (result === 'missing') return reply.code(404).send({ error: 'Agent template version not found' });
        if (result === 'stale') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_VERSION_CHANGED' });
        return reply.send({ currentVersion: request.params.version });
    });

    app.post('/v1/ai-team/agent-templates/:id/rollback', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            version: z.number().int().positive(), confirmed: z.literal(true),
        }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgentTemplate" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} FOR UPDATE`;
            if (!locked.length) return 'missing' as const;
            const version = await tx.aiAgentTemplateVersion.findUnique({ where: {
                templateId_version: { templateId: request.params.id,
                    version: request.body.version },
            } });
            if (!version?.publishedAt) return 'unpublished' as const;
            await tx.aiAgentTemplate.update({ where: { id: request.params.id },
                data: { currentVersion: version.version } });
            return 'ok' as const;
        });
        if (result === 'missing') return reply.code(404).send({ error: 'Agent template not found' });
        if (result === 'unpublished') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_UNPUBLISHED' });
        return reply.send({ currentVersion: request.body.version });
    });

    app.post('/v1/ai-team/agents/:agentId/apply-template', { preHandler: app.authenticate,
        schema: { params: z.object({ agentId: id }), body: z.object({
            templateId: id, expectedVersion: z.number().int().positive(),
            confirmed: z.literal(true),
        }).strict() },
    }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const template = await tx.aiAgentTemplate.findFirst({ where: {
                id: request.body.templateId, accountId: request.userId },
            });
            if (!template) return 'missing' as const;
            await tx.$queryRaw`SELECT id FROM "AiAgentTemplate" WHERE id=${template.id} FOR SHARE`;
            const current = await tx.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } });
            if (current.currentVersion !== request.body.expectedVersion) return 'stale' as const;
            const version = await tx.aiAgentTemplateVersion.findUnique({ where: {
                templateId_version: { templateId: template.id, version: current.currentVersion },
            } });
            if (!version?.publishedAt) return 'stale' as const;
            const agents = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgent" WHERE id=${request.params.agentId}
                  AND "accountId"=${request.userId} AND "archivedAt" IS NULL FOR UPDATE`;
            if (!agents.length) return 'missing' as const;
            const content = contentSchema.parse(version.content);
            const agent = await tx.aiAgent.findUniqueOrThrow({ where: { id: request.params.agentId } });
            const settings = { ...(agent.settings as Record<string, unknown>),
                instructions: content.instructions };
            await tx.aiAgent.update({ where: { id: agent.id }, data: {
                role: content.role, description: content.description, emoji: content.emoji,
                skills: content.skills, responsibilities: content.responsibilities,
                instructions: content.instructions, settings: settings as Prisma.InputJsonValue,
                templateVersionId: version.id,
            } });
            return { version: version.version, contentHash: version.contentHash };
        });
        if (result === 'missing') return reply.code(404).send({ error: 'Agent or template not found' });
        if (result === 'stale') return reply.code(409).send({ errorCode: 'AGENT_TEMPLATE_VERSION_CHANGED' });
        return reply.send(result);
    });
}

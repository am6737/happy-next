import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/storage/db';
import { assertExecutionCapabilityTx } from '@/app/ai/workspaceAuth';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const fileSchema = z.object({ path: z.string().min(1).max(200), contentBase64: z.string().max(350_000) }).strict();

function decodeFiles(input: Array<z.infer<typeof fileSchema>>) {
    if (input.length < 1 || input.length > 16 || !input.some((file) => file.path === 'SKILL.md')) {
        throw new Error('SKILL.md and at most 15 support files are required');
    }
    const seen = new Set<string>();
    let total = 0;
    const files = input.map((file) => {
        if (file.path.startsWith('/') || file.path.includes('\\') || file.path.includes('\0')
            || file.path.split('/').some((part) => !part || part === '.' || part === '..')
            || !/^[A-Za-z0-9._/-]+$/.test(file.path) || seen.has(file.path)) {
            throw new Error('Invalid or duplicate skill file path');
        }
        seen.add(file.path);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) {
            throw new Error('Invalid base64 file content');
        }
        const content = Buffer.from(file.contentBase64, 'base64');
        total += content.length;
        if (content.length > 256_000 || total > 1_000_000) throw new Error('Skill files exceed size limit');
        if (file.path === 'SKILL.md' && (!content.length || content.includes(0))) {
            throw new Error('SKILL.md must be nonempty UTF-8 text');
        }
        if (file.path === 'SKILL.md') {
            try { new TextDecoder('utf-8', { fatal: true }).decode(content); }
            catch { throw new Error('SKILL.md must be valid UTF-8'); }
        }
        return { path: file.path, content, size: content.length,
            sha256: createHash('sha256').update(content).digest('hex') };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const contentHash = createHash('sha256').update(JSON.stringify(files.map(({ path, sha256 }) =>
        ({ path, sha256 })))).digest('hex');
    return { files, contentHash };
}

export function aiSkillRoutes(app: Fastify) {
    app.get('/v1/ai-team/skills', { preHandler: app.authenticate }, async (request, reply) => {
        const rows = await db.aiSkill.findMany({ where: { accountId: request.userId },
            orderBy: { updatedAt: 'desc' }, take: 100,
            select: { id: true, name: true, teamId: true, currentVersion: true, updatedAt: true } });
        return reply.send({ items: rows });
    });
    app.get('/v1/ai-team/skills/:id', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const skill = await db.aiSkill.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true, name: true,
            teamId: true, currentVersion: true,
            versions: { orderBy: { version: 'desc' }, select: { version: true,
                contentHash: true, publishedAt: true, createdAt: true } },
            bindings: { select: { agentId: true } },
        } });
        if (!skill) return reply.code(404).send({ error: 'Skill not found' });
        return reply.send(skill);
    });
    app.get('/v1/ai-team/skills/:id/proposals', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            status: z.enum(['pending', 'accepted', 'rejected']).optional(),
        }) },
    }, async (request, reply) => {
        const skill = await db.aiSkill.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true } });
        if (!skill) return reply.code(404).send({ error: 'Skill not found' });
        const rows = await db.aiSkillProposal.findMany({ where: { skillId: skill.id,
            accountId: request.userId, ...(request.query.status ? { status: request.query.status } : {}) },
            orderBy: { createdAt: 'desc' }, take: 100,
            select: { id: true, text: true, status: true, createdAt: true, reviewedAt: true } });
        return reply.send({ items: rows });
    });
    app.get('/v1/ai-team/skills/:id/versions/:version', { preHandler: app.authenticate,
        schema: { params: z.object({ id, version: z.coerce.number().int().positive() }) },
    }, async (request, reply) => {
        const version = await db.aiSkillVersion.findFirst({ where: {
            skillId: request.params.id, version: request.params.version,
            skill: { accountId: request.userId },
        }, include: { files: { orderBy: { path: 'asc' } },
            skill: { select: { currentVersion: true } } } });
        if (!version) return reply.code(404).send({ error: 'Skill version not found' });
        return reply.send({ skillId: version.skillId, version: version.version,
            hash: version.contentHash, publishedAt: version.publishedAt,
            isCurrent: version.skill.currentVersion === version.version,
            files: version.files.map((file) => ({ path: file.path, sha256: file.sha256,
                size: file.size, contentBase64: Buffer.from(file.content).toString('base64') })) });
    });
    app.post('/v1/ai-team/skills', { preHandler: app.authenticate,
        schema: { body: z.object({ name: z.string().trim().min(1).max(100), teamId: id.nullish() }).strict() },
    }, async (request, reply) => {
        if (request.body.teamId && !await db.aiTeam.findFirst({ where: { id: request.body.teamId,
            accountId: request.userId, archivedAt: null }, select: { id: true } })) {
            return reply.code(403).send({ error: 'Team is unavailable' });
        }
        try {
            const row = await db.aiSkill.create({ data: { accountId: request.userId,
                name: request.body.name, teamId: request.body.teamId ?? null } });
            return reply.code(201).send({ id: row.id });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return reply.code(409).send({ error: 'Skill name already exists' });
            }
            throw error;
        }
    });
    app.post('/v1/ai-team/skills/:id/versions', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ files: z.array(fileSchema).min(1).max(16) }).strict() },
    }, async (request, reply) => {
        let decoded: ReturnType<typeof decodeFiles>;
        try { decoded = decodeFiles(request.body.files); }
        catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid skill files' }); }
        try {
            const result = await db.$transaction(async (tx) => {
                const skill = await tx.aiSkill.findFirst({ where: { id: request.params.id,
                    accountId: request.userId }, select: { id: true } });
                if (!skill) return null;
                const latest = await tx.aiSkillVersion.findFirst({ where: { skillId: skill.id },
                    orderBy: { version: 'desc' }, select: { version: true, contentHash: true } });
                if (latest?.contentHash === decoded.contentHash) return { version: latest.version,
                    contentHash: decoded.contentHash, duplicate: true };
                const version = (latest?.version ?? 0) + 1;
                await tx.aiSkillVersion.create({ data: { skillId: skill.id, version,
                    contentHash: decoded.contentHash, files: { create: decoded.files } } });
                return { version, contentHash: decoded.contentHash, duplicate: false };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            if (!result) return reply.code(404).send({ error: 'Skill not found' });
            return reply.code(result.duplicate ? 200 : 201).send(result);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
                return reply.code(503).send({ error: 'Version is processing; retry' });
            }
            throw error;
        }
    });
    app.post('/v1/ai-team/skills/:id/versions/:version/publish', { preHandler: app.authenticate,
        schema: { params: z.object({ id, version: z.coerce.number().int().positive() }),
            body: z.object({ confirmed: z.literal(true) }) },
    }, async (request, reply) => {
        const result = await db.$transaction(async (tx) => {
            const skill = await tx.aiSkill.findFirst({ where: { id: request.params.id,
                accountId: request.userId } });
            if (!skill) return 'not_found' as const;
            const version = await tx.aiSkillVersion.findUnique({ where: { skillId_version: {
                skillId: skill.id, version: request.params.version,
            } } });
            if (!version) return 'not_found' as const;
            await tx.aiSkillVersion.update({ where: { skillId_version: {
                skillId: skill.id, version: version.version,
            } }, data: { publishedAt: version.publishedAt ?? new Date() } });
            await tx.aiSkill.update({ where: { id: skill.id }, data: { currentVersion: version.version } });
            return 'published' as const;
        });
        if (result === 'not_found') return reply.code(404).send({ error: 'Skill version not found' });
        return reply.send({ status: result, version: request.params.version });
    });
    app.post('/v1/ai-team/skills/:id/rollback', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ version: z.number().int().positive(),
            confirmed: z.literal(true) }) },
    }, async (request, reply) => {
        const changed = await db.aiSkill.updateMany({ where: { id: request.params.id,
            accountId: request.userId, versions: { some: { version: request.body.version,
                publishedAt: { not: null } } } }, data: { currentVersion: request.body.version } });
        if (!changed.count) return reply.code(409).send({ error: 'Published version is unavailable' });
        return reply.send({ version: request.body.version });
    });
    app.post('/v1/ai-team/skills/:id/bindings', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ agentId: id }) },
    }, async (request, reply) => {
        const skill = await db.aiSkill.findFirst({ where: { id: request.params.id,
            accountId: request.userId, currentVersion: { not: null } } });
        if (!skill) return reply.code(404).send({ error: 'Published skill not found' });
        const agent = await db.aiAgent.findFirst({ where: { id: request.body.agentId,
            accountId: request.userId, enabled: true, archivedAt: null } });
        if (!agent) return reply.code(403).send({ error: 'Agent is unavailable' });
        if (skill.teamId && !await db.aiTeamMember.findFirst({ where: {
            teamId: skill.teamId, agentId: agent.id,
        } })) return reply.code(403).send({ error: 'Agent is not a team member' });
        await db.aiSkillAgentBinding.upsert({ where: { skillId_agentId: {
            skillId: skill.id, agentId: agent.id,
        } }, create: { skillId: skill.id, agentId: agent.id, accountId: request.userId }, update: {} });
        return reply.send({ skillId: skill.id, agentId: agent.id });
    });
    app.delete('/v1/ai-team/skills/:id/bindings/:agentId', { preHandler: app.authenticate,
        schema: { params: z.object({ id, agentId: id }) },
    }, async (request, reply) => {
        const skill = await db.aiSkill.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true } });
        if (!skill) return reply.code(404).send({ error: 'Skill not found' });
        await db.aiSkillAgentBinding.deleteMany({ where: { skillId: skill.id,
            agentId: request.params.agentId, accountId: request.userId } });
        return reply.code(204).send();
    });
    app.post('/v1/ai-team/skills/:id/proposals', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ text: z.string().trim().min(1).max(12_000) }) },
    }, async (request, reply) => {
        const skill = await db.aiSkill.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true } });
        if (!skill) return reply.code(404).send({ error: 'Skill not found' });
        const proposal = await db.aiSkillProposal.create({ data: { skillId: skill.id,
            accountId: request.userId, text: request.body.text } });
        return reply.code(201).send({ id: proposal.id, status: 'pending' });
    });
    app.post('/v1/ai-team/skills/:id/proposals/:proposalId/review', { preHandler: app.authenticate,
        schema: { params: z.object({ id, proposalId: id }),
            body: z.object({ decision: z.enum(['accepted', 'rejected']), confirmed: z.literal(true) }) },
    }, async (request, reply) => {
        const changed = await db.aiSkillProposal.updateMany({ where: { id: request.params.proposalId,
            skillId: request.params.id, accountId: request.userId, status: 'pending' },
            data: { status: request.body.decision, reviewedAt: new Date() } });
        if (!changed.count) return reply.code(409).send({ error: 'Proposal unavailable' });
        return reply.send({ status: request.body.decision });
    });
    app.post('/v1/ai-team/tasks/:id/skills/download', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            executionId: id, dispatchToken: z.string().min(1),
            capability: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        }) },
    }, async (request, reply) => {
        try {
            const result = await db.$transaction(async (tx) => {
                const execution = await tx.orchestratorExecution.findFirst({ where: {
                    id: request.body.executionId, taskId: request.params.id,
                    dispatchToken: request.body.dispatchToken,
                    status: { in: ['dispatching', 'running'] }, run: { accountId: request.userId },
                }, select: { id: true, machineId: true, capabilityProtocolVersion: true } });
                if (!execution) return { code: 403 as const, items: [] };
                if (execution.capabilityProtocolVersion > 0 && !request.body.capability) {
                    return { code: 409 as const, items: [] };
                }
                if (request.body.capability) await assertExecutionCapabilityTx(tx, {
                    accountId: request.userId, executionId: execution.id,
                    machineId: execution.machineId, token: request.body.capability,
                    operation: 'skill_download',
                });
                const snapshots = await tx.aiTaskSkillSnapshot.findMany({ where: {
                    taskId: request.params.id } });
                const items = await Promise.all(snapshots.map(async (snapshot) => {
                    const version = await tx.aiSkillVersion.findFirst({ where: {
                        skillId: snapshot.skillId, version: snapshot.version,
                        contentHash: snapshot.contentHash,
                        skill: { accountId: request.userId },
                    }, include: { files: { orderBy: { path: 'asc' } } } });
                    if (!version) return null;
                    return { skillId: snapshot.skillId, version: snapshot.version,
                        hash: snapshot.contentHash, files: version.files.map((file) => ({
                            path: file.path, sha256: file.sha256,
                            contentBase64: Buffer.from(file.content).toString('base64'),
                        })) };
                }));
                return { code: items.some((item) => !item) ? 409 as const : 200 as const, items };
            });
            if (result.code !== 200) return reply.code(result.code).send({ error: result.code === 403
                ? 'Execution is unavailable' : 'Skill snapshot is unavailable' });
            return reply.send({ items: result.items });
        } catch { return reply.code(409).send({ error: 'Execution capability is unavailable' }); }
    });
}

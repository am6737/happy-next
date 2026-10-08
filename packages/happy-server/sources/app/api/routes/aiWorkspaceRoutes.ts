import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { authorizeWorkspace, ensureOwnerWorkspace, issueExecutionCapability,
    renewDispatchCapability, verifyExecutionCapability, requestExpiredCapabilityDrain,
    confirmExpiredCapabilityDrain, claimExpiredCapabilityDrain } from '@/app/ai/workspaceAuth';
import { invokeUserRpc } from '../socket/rpcRegistry';
import { randomUUID } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { beginHumanCredentialRegistration, completeHumanCredentialRegistration,
    trustHumanCredential, revokeHumanCredential,
    beginHumanRecoveryConfirmation } from '@/app/ai/humanPresence';
import { isApprovalTerminalFailure } from '@/app/ai/approvalTerminalFailure';
import { safeErrorCode } from '@/app/ai/safeErrorCode';
import type { Fastify } from '../types';

const id = z.string().min(1).max(200);
const webauthnRegistration = z.object({ id: z.string().min(1).max(4096),
    rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: z.string().min(1),
        attestationObject: z.string().min(1) }).passthrough(),
}).passthrough();
const webauthnAssertion = z.object({ id: z.string().min(1).max(4096),
    rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: z.string().min(1),
        authenticatorData: z.string().min(1),
        signature: z.string().min(1) }).passthrough(),
}).passthrough();

type WorkProjection = { projectId: string | null; projectVersion: number | null;
    assigneeId: string; acceptanceStatus: string; deliveryVerificationStatus: string };
type GrantProjection = { resourceKind: string; resourceId: string;
    canView: boolean; canRun: boolean; canApprove: boolean };

function workPermissions(role: string, grants: GrantProjection[], work: WorkProjection) {
    if (role === 'owner' || role === 'admin') return { view: true, run: true, approve: true };
    const resources = [{ kind: 'agent', id: work.assigneeId },
        ...(work.projectId ? [{ kind: 'project', id: work.projectId }] : [])];
    const selected = resources.map(resource => grants.find(grant =>
        grant.resourceKind === resource.kind && grant.resourceId === resource.id));
    return { view: selected.every(grant => grant?.canView === true),
        run: selected.every(grant => grant?.canView === true && grant.canRun),
        approve: selected.every(grant => grant?.canView === true && grant.canApprove) };
}

function availableWorkActions(work: WorkProjection, runStatus: string,
    taskStatus: string | null, executionStatus: string | null,
    errorCode: string | null,
    permissions: ReturnType<typeof workPermissions>, localProject: boolean) {
    const actions: string[] = [];
    if (permissions.run && !['completed', 'failed', 'cancelled'].includes(runStatus)) actions.push('cancel');
    if (permissions.run && taskStatus === 'failed'
        && !isApprovalTerminalFailure(errorCode)) actions.push('retry');
    if (permissions.run && runStatus === 'running' && taskStatus === 'running'
        && executionStatus === 'running') actions.push('steering');
    if (permissions.approve && runStatus === 'completed' && taskStatus === 'completed'
        && executionStatus === 'completed' && work.acceptanceStatus !== 'approved'
        && (localProject || work.deliveryVerificationStatus === 'verified')) actions.push('approve');
    if (permissions.run && permissions.approve && taskStatus === 'completed') {
        actions.push('changes_requested');
    }
    return actions;
}

async function workspaceAdminTx(tx: Prisma.TransactionClient, workspaceId: string,
    actorAccountId: string): Promise<boolean> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AiWorkspace" WHERE id=${workspaceId} FOR UPDATE`;
    if (locked.length !== 1) return false;
    const actor = await tx.aiWorkspaceMembership.findUnique({ where: {
        workspaceId_memberAccountId: { workspaceId, memberAccountId: actorAccountId },
    }, select: { role: true } });
    return Boolean(actor && ['owner', 'admin'].includes(actor.role));
}

export function aiWorkspaceRoutes(app: Fastify) {
    app.get('/v1/ai-team/workspaces', { preHandler: app.authenticate }, async (request, reply) => {
        await ensureOwnerWorkspace(request.userId);
        const rows = await db.aiWorkspaceMembership.findMany({ where: {
            memberAccountId: request.userId,
        }, include: { workspace: true }, orderBy: { createdAt: 'asc' } });
        return reply.send({ items: rows.map((row) => ({ id: row.workspaceId,
            name: row.workspace.name, role: row.role,
            ownerAccountId: row.workspace.ownerAccountId })) });
    });
    app.get('/v1/ai-team/workspaces/:id/members', { preHandler: app.authenticate,
        schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        const items = await db.aiWorkspaceMembership.findMany({ where: { workspaceId: workspace.id },
            select: { memberAccountId: true, role: true, createdAt: true },
            orderBy: { createdAt: 'asc' } });
        return reply.send({ items, authRevision: workspace.authRevision });
    });
    app.get('/v1/ai-team/workspaces/:id/resources', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            kind: z.enum(['project', 'agent']),
        }) },
    }, async (request, reply) => {
        const membership = await db.aiWorkspaceMembership.findUnique({ where: {
            workspaceId_memberAccountId: { workspaceId: request.params.id,
                memberAccountId: request.userId },
        }, include: { workspace: true } });
        if (!membership) return reply.code(404).send({ error: 'Workspace not found' });
        const unrestricted = membership.role === 'owner' || membership.role === 'admin';
        const grants = unrestricted ? [] : await db.aiWorkspaceGrant.findMany({ where: {
            workspaceId: request.params.id, memberAccountId: request.userId,
            resourceKind: request.query.kind, canView: true,
        }, select: { resourceId: true } });
        const ids = grants.map((grant) => grant.resourceId);
        if (!unrestricted && !ids.length) return reply.send({ items: [] });
        const items = request.query.kind === 'project'
            ? await db.aiProject.findMany({ where: { accountId: membership.workspace.ownerAccountId,
                ...(!unrestricted ? { id: { in: ids } } : {}) },
                select: { id: true, name: true, currentVersion: true, active: true },
                orderBy: { updatedAt: 'desc' }, take: 100 })
            : await db.aiAgent.findMany({ where: { accountId: membership.workspace.ownerAccountId,
                archivedAt: null, ...(!unrestricted ? { id: { in: ids } } : {}) },
                select: { id: true, name: true, role: true, enabled: true },
                orderBy: { updatedAt: 'desc' }, take: 100 });
        return reply.send({ items });
    });
    app.get('/v1/ai-team/workspaces/:id/work-items', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({
            limit: z.coerce.number().int().min(1).max(100).optional(),
        }) },
    }, async (request, reply) => {
        const membership = await db.aiWorkspaceMembership.findUnique({ where: {
            workspaceId_memberAccountId: { workspaceId: request.params.id,
                memberAccountId: request.userId },
        }, include: { workspace: true } });
        if (!membership) return reply.code(404).send({ error: 'Workspace not found' });
        const elevated = ['owner', 'admin'].includes(membership.role);
        const grants = elevated ? [] : await db.aiWorkspaceGrant.findMany({ where: {
            workspaceId: request.params.id, memberAccountId: request.userId,
            canView: true }, select: { resourceKind: true, resourceId: true,
                canView: true, canRun: true, canApprove: true } });
        const projectIds = grants.filter((item) => item.resourceKind === 'project')
            .map((item) => item.resourceId);
        const agentIds = grants.filter((item) => item.resourceKind === 'agent')
            .map((item) => item.resourceId);
        const items = elevated || agentIds.length
            ? await db.aiWorkItem.findMany({ where: {
                accountId: membership.workspace.ownerAccountId,
                ...(!elevated ? { assigneeId: { in: agentIds },
                    OR: [{ projectId: null }, { projectId: { in: projectIds } }] } : {}),
            }, orderBy: { updatedAt: 'desc' }, take: request.query.limit ?? 50,
            select: { id: true, title: true, summary: true, priority: true,
                labels: true, dueDate: true, metadataRevision: true, projectId: true,
                projectVersion: true, assigneeId: true, teamId: true,
                orchestratorRunId: true, orchestratorTaskId: true, acceptanceStatus: true,
                deliveryVerificationStatus: true, createdAt: true, updatedAt: true,
                orchestratorRun: { select: { status: true } } } }) : [];
        const executions = items.length ? await db.orchestratorExecution.findMany({ where: {
            taskId: { in: items.map((item) => item.orchestratorTaskId) },
        }, orderBy: { attempt: 'desc' }, distinct: ['taskId'],
        select: { id: true, taskId: true, status: true, errorCode: true } }) : [];
        const byTask = new Map(executions.map((execution) => [execution.taskId, execution]));
        const tasks = items.length ? await db.orchestratorTask.findMany({ where: {
            id: { in: items.map(item => item.orchestratorTaskId) } },
        select: { id: true, status: true, errorCode: true } }) : [];
        const taskStatus = new Map(tasks.map(task => [task.id, task.status]));
        const taskErrorCode = new Map(tasks.map(task => [task.id, task.errorCode]));
        const projectVersions = items.filter(item => item.projectId && item.projectVersion)
            .map(item => ({ projectId: item.projectId!, version: item.projectVersion! }));
        const localVersions = projectVersions.length ? await db.aiProjectVersion.findMany({
            where: { OR: projectVersions }, select: { projectId: true, version: true, kind: true },
        }) : [];
        const localKeys = new Set(localVersions.filter(version => version.kind === 'local')
            .map(version => `${version.projectId}:${version.version}`));
        return reply.send({ items: items.map(({ orchestratorRun, ...item }) => ({
            ...item, runStatus: orchestratorRun.status,
            taskStatus: taskStatus.get(item.orchestratorTaskId) ?? null,
            orchestratorExecutionId: byTask.get(item.orchestratorTaskId)?.id ?? null,
            latestExecutionStatus: byTask.get(item.orchestratorTaskId)?.status ?? null,
            errorCode: safeErrorCode(byTask.has(item.orchestratorTaskId)
                ? byTask.get(item.orchestratorTaskId)?.errorCode
                : taskErrorCode.get(item.orchestratorTaskId)),
            workspaceAuthRevision: membership.workspace.authRevision,
            availableActions: availableWorkActions(item, orchestratorRun.status,
                taskStatus.get(item.orchestratorTaskId) ?? null,
                byTask.get(item.orchestratorTaskId)?.status ?? null,
                safeErrorCode(byTask.has(item.orchestratorTaskId)
                    ? byTask.get(item.orchestratorTaskId)?.errorCode
                    : taskErrorCode.get(item.orchestratorTaskId)),
                workPermissions(membership.role, grants, item),
                localKeys.has(`${item.projectId}:${item.projectVersion}`)),
        })) });
    });
    app.get('/v1/ai-team/workspaces/:id/work-items/:workItemId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id, workItemId: id }) },
    }, async (request, reply) => {
        const membership = await db.aiWorkspaceMembership.findUnique({ where: {
            workspaceId_memberAccountId: { workspaceId: request.params.id,
                memberAccountId: request.userId },
        }, include: { workspace: true } });
        if (!membership) return reply.code(404).send({ error: 'Work item not found' });
        const work = await db.aiWorkItem.findFirst({ where: { id: request.params.workItemId,
            accountId: membership.workspace.ownerAccountId },
        select: { id: true, title: true, summary: true, priority: true,
            labels: true, dueDate: true, metadataRevision: true, projectId: true,
            projectVersion: true, assigneeId: true, teamId: true,
            orchestratorRunId: true, orchestratorTaskId: true, acceptanceStatus: true,
            deliveryVerificationStatus: true, createdAt: true, updatedAt: true,
            orchestratorRun: { select: { status: true } } } });
        if (!work) return reply.code(404).send({ error: 'Work item not found' });
        const grants = ['owner', 'admin'].includes(membership.role) ? []
            : await db.aiWorkspaceGrant.findMany({ where: {
                workspaceId: request.params.id, memberAccountId: request.userId,
                canView: true, OR: [{ resourceKind: 'agent', resourceId: work.assigneeId },
                    ...(work.projectId ? [{ resourceKind: 'project', resourceId: work.projectId }] : [])],
            }, select: { resourceKind: true, resourceId: true,
                canView: true, canRun: true, canApprove: true } });
        if (!workPermissions(membership.role, grants, work).view) {
            return reply.code(404).send({ error: 'Work item not found' });
        }
        const { orchestratorRun, ...item } = work;
        const latest = await db.orchestratorExecution.findFirst({ where: {
            taskId: work.orchestratorTaskId }, orderBy: { attempt: 'desc' },
        select: { id: true, status: true, errorCode: true } });
        const task = await db.orchestratorTask.findUnique({ where: {
            id: work.orchestratorTaskId }, select: { status: true, errorCode: true } });
        const localVersion = work.projectId && work.projectVersion
            ? await db.aiProjectVersion.findUnique({ where: { projectId_version: {
                projectId: work.projectId, version: work.projectVersion,
            } }, select: { kind: true } }) : null;
        return reply.send({ ...item, runStatus: orchestratorRun.status,
            taskStatus: task?.status ?? null,
            orchestratorExecutionId: latest?.id ?? null,
            latestExecutionStatus: latest?.status ?? null,
            errorCode: safeErrorCode(latest ? latest.errorCode : task?.errorCode),
            workspaceAuthRevision: membership.workspace.authRevision,
            availableActions: availableWorkActions(work, orchestratorRun.status,
                task?.status ?? null, latest?.status ?? null,
                safeErrorCode(latest ? latest.errorCode : task?.errorCode),
                workPermissions(membership.role, grants, work), localVersion?.kind === 'local') });
    });
    app.put('/v1/ai-team/workspaces/:id/members/:accountId', { preHandler: app.authenticate,
        schema: { params: z.object({ id, accountId: id }),
            body: z.object({ role: z.enum(['admin', 'member']) }).strict() },
    }, async (request, reply) => {
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace || request.params.accountId === workspace.ownerAccountId) {
            return reply.code(404).send({ error: 'Workspace or member not found' });
        }
        if (!await db.account.findUnique({ where: { id: request.params.accountId }, select: { id: true } })) {
            return reply.code(404).send({ error: 'Member account not found' });
        }
        const changed = await db.$transaction(async (tx) => {
            if (!await workspaceAdminTx(tx, workspace.id, request.userId)) return false;
            await tx.aiWorkspaceMembership.upsert({ where: { workspaceId_memberAccountId: {
                workspaceId: workspace.id, memberAccountId: request.params.accountId,
            } }, create: { workspaceId: workspace.id, memberAccountId: request.params.accountId,
                role: request.body.role }, update: { role: request.body.role } });
            await tx.aiWorkspace.update({ where: { id: workspace.id },
                data: { authRevision: { increment: 1 } } });
            return true;
        });
        if (!changed) return reply.code(404).send({ error: 'Workspace not found' });
        return reply.send({ role: request.body.role });
    });
    app.delete('/v1/ai-team/workspaces/:id/members/:accountId', { preHandler: app.authenticate,
        schema: { params: z.object({ id, accountId: id }) },
    }, async (request, reply) => {
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace || request.params.accountId === workspace.ownerAccountId) {
            return reply.code(404).send({ error: 'Workspace or member not found' });
        }
        const changed = await db.$transaction(async (tx) => {
            if (!await workspaceAdminTx(tx, workspace.id, request.userId)) return false;
            const removed = await tx.aiWorkspaceMembership.deleteMany({ where: {
                workspaceId: workspace.id, memberAccountId: request.params.accountId,
            } });
            if (removed.count) {
                await tx.aiWorkspaceGrant.deleteMany({ where: { workspaceId: workspace.id,
                    memberAccountId: request.params.accountId } });
                await tx.aiWorkspace.update({ where: { id: workspace.id },
                    data: { authRevision: { increment: 1 } } });
                await tx.aiExecutionCapability.updateMany({ where: { workspaceId: workspace.id,
                    revokedAt: null }, data: { revokedAt: new Date() } });
            }
            return true;
        });
        if (!changed) return reply.code(404).send({ error: 'Workspace not found' });
        return reply.code(204).send();
    });
    app.get('/v1/ai-team/workspaces/:id/grants', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), querystring: z.object({ memberAccountId: id }).strict() },
    }, async (request, reply) => {
        const snapshot = await db.$transaction(async (tx) => {
            if (!await workspaceAdminTx(tx, request.params.id, request.userId)) return null;
            const workspace = await tx.aiWorkspace.findUnique({ where: { id: request.params.id },
                select: { authRevision: true } });
            const member = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: request.params.id,
                    memberAccountId: request.query.memberAccountId },
            }, select: { role: true } });
            if (!workspace || !member) return null;
            const grants = await tx.aiWorkspaceGrant.findMany({ where: {
                workspaceId: request.params.id, memberAccountId: request.query.memberAccountId,
            }, select: { resourceKind: true, resourceId: true,
                canView: true, canRun: true, canApprove: true },
            orderBy: [{ resourceKind: 'asc' }, { resourceId: 'asc' }] });
            return { memberAccountId: request.query.memberAccountId, role: member.role,
                authRevision: workspace.authRevision, grants };
        });
        if (!snapshot) return reply.code(404).send({ error: 'Workspace or member not found' });
        return reply.send(snapshot);
    });
    app.put('/v1/ai-team/workspaces/:id/grants', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            memberAccountId: id, resourceKind: z.enum(['project', 'agent']), resourceId: id,
            canView: z.boolean(), canRun: z.boolean(), canApprove: z.boolean(),
            expectedAuthRevision: z.number().int().positive().optional(),
        }).strict() },
    }, async (request, reply) => {
        if ((request.body.canRun || request.body.canApprove) && !request.body.canView) {
            return reply.code(400).send({ error: 'Run and approve grants require view' });
        }
        const workspace = await authorizeWorkspace(request.userId, request.params.id, 'admin');
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        const member = await db.aiWorkspaceMembership.findUnique({ where: {
            workspaceId_memberAccountId: { workspaceId: workspace.id,
                memberAccountId: request.body.memberAccountId },
        } });
        const owned = request.body.resourceKind === 'project'
            ? await db.aiProject.findFirst({ where: { id: request.body.resourceId,
                accountId: workspace.ownerAccountId }, select: { id: true } })
            : await db.aiAgent.findFirst({ where: { id: request.body.resourceId,
                accountId: workspace.ownerAccountId }, select: { id: true } });
        if (!member || !owned) return reply.code(404).send({ error: 'Member or resource not found' });
        const changed = await db.$transaction(async (tx) => {
            if (!await workspaceAdminTx(tx, workspace.id, request.userId)) return false;
            if (request.body.expectedAuthRevision !== undefined) {
                const current = await tx.aiWorkspace.findUnique({ where: { id: workspace.id },
                    select: { authRevision: true } });
                if (current?.authRevision !== request.body.expectedAuthRevision) return 'stale' as const;
            }
            const currentMember = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: workspace.id,
                    memberAccountId: request.body.memberAccountId },
            }, select: { memberAccountId: true } });
            if (!currentMember) return false;
            const key = { workspaceId: workspace.id, memberAccountId: request.body.memberAccountId,
                resourceKind: request.body.resourceKind, resourceId: request.body.resourceId };
            const permissions = { canView: request.body.canView, canRun: request.body.canRun,
                canApprove: request.body.canApprove };
            await tx.aiWorkspaceGrant.upsert({ where: {
                workspaceId_memberAccountId_resourceKind_resourceId: key,
            }, create: { ...key, ...permissions }, update: permissions });
            await tx.aiWorkspace.update({ where: { id: workspace.id },
                data: { authRevision: { increment: 1 } } });
            return true;
        });
        if (changed === 'stale') return reply.code(409).send({ errorCode: 'AUTH_REVISION_CHANGED' });
        if (!changed) return reply.code(404).send({ error: 'Workspace or member not found' });
        return reply.send({ ok: true });
    });
    app.post('/v1/ai-team/executions/:id/capabilities', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            allowedOps: z.array(z.enum(['event', 'usage', 'decision_request'])).min(1).max(3),
            expiresInSeconds: z.number().int().min(30).max(3600),
        }).strict() },
    }, async (request, reply) => {
        const execution = await db.orchestratorExecution.findFirst({ where: { id: request.params.id,
            run: { accountId: request.userId } }, select: { id: true } });
        if (!execution) return reply.code(404).send({ error: 'Execution not found' });
        try {
            const issued = await issueExecutionCapability({ accountId: request.userId,
                executionId: execution.id, allowedOps: request.body.allowedOps,
                expiresAt: new Date(Date.now() + request.body.expiresInSeconds * 1000) });
            return reply.code(201).send(issued);
        } catch { return reply.code(409).send({ error: 'Execution is not active' }); }
    });
    app.post('/v1/ai-team/executions/:id/capabilities/verify', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({ token: z.string(), machineId: id,
            operation: z.enum(['finish', 'skill_download', 'delegate', 'event', 'usage',
                'decision_request']) }).strict() },
    }, async (request, reply) => {
        const valid = await verifyExecutionCapability({ token: request.body.token,
            accountId: request.userId, executionId: request.params.id,
            machineId: request.body.machineId, operation: request.body.operation });
        return reply.send({ valid });
    });
    app.post('/v1/ai-team/executions/:id/capabilities/renew', { preHandler: app.authenticate,
        schema: { params: z.object({ id }), body: z.object({
            machineId: id, dispatchToken: z.string().min(1),
            capability: z.string().regex(/^[0-9a-f]{64}$/),
        }).strict() },
    }, async (request, reply) => {
        try {
            const issued = await renewDispatchCapability({ accountId: request.userId,
                executionId: request.params.id, machineId: request.body.machineId,
                dispatchToken: request.body.dispatchToken, token: request.body.capability });
            return reply.code(201).send(issued);
        } catch { return reply.code(409).send({ error: 'CAPABILITY_RENEWAL_UNAVAILABLE' }); }
    });
    app.post('/v1/ai-team/human-credentials/registration/options', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        try { return reply.code(201).send(await beginHumanCredentialRegistration(request.userId)); }
        catch { return reply.code(409).send({ errorCode: 'HUMAN_CREDENTIAL_REGISTRATION_UNAVAILABLE' }); }
    });
    app.post('/v1/ai-team/human-credentials/registration/verify', {
        preHandler: app.authenticate, schema: { body: z.object({
            challengeId: id, response: webauthnRegistration,
        }).strict() },
    }, async (request, reply) => {
        try {
            return reply.code(201).send(await completeHumanCredentialRegistration({
                accountId: request.userId, challengeId: request.body.challengeId,
                response: request.body.response as unknown as RegistrationResponseJSON,
            }));
        } catch { return reply.code(409).send({ errorCode: 'HUMAN_CREDENTIAL_REGISTRATION_INVALID' }); }
    });
    app.get('/v1/ai-team/human-credentials', { preHandler: app.authenticate },
        async (request, reply) => {
            const items = await db.aiHumanCredential.findMany({ where: {
                accountId: request.userId }, orderBy: { createdAt: 'desc' }, take: 100,
            select: { id: true, status: true, deviceType: true, backedUp: true,
                createdAt: true, trustedAt: true, revokedAt: true, lastUsedAt: true } });
            return reply.send({ items });
        });
    app.post('/v1/ai-team/human-credentials/:id/trust', {
        preHandler: app.authenticate, schema: { params: z.object({ id }),
            body: z.object({ approval: z.object({ accountId: id,
                credentialId: id, approvalNonce: z.string().uuid(),
                actorLabel: z.string().trim().min(3).max(200),
                evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
                expiresAt: z.string().datetime(),
            }).strict(), signature: z.string().regex(/^[A-Za-z0-9_-]{64,512}$/),
        }).strict() },
    }, async (request, reply) => {
        if (request.params.id !== request.body.approval.credentialId) {
            return reply.code(409).send({ errorCode: 'HUMAN_CREDENTIAL_TRUST_INVALID' });
        }
        try { return reply.send(await trustHumanCredential({ accountId: request.userId,
            approval: request.body.approval, signature: request.body.signature })); }
        catch { return reply.code(409).send({ errorCode: 'HUMAN_CREDENTIAL_TRUST_INVALID' }); }
    });
    app.post('/v1/ai-team/human-credentials/:id/revoke', {
        preHandler: app.authenticate, schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const result = await revokeHumanCredential(request.userId, request.params.id);
        if (!result) return reply.code(404).send({ errorCode: 'HUMAN_CREDENTIAL_NOT_FOUND' });
        return reply.send(result);
    });
    app.post('/v1/ai-team/executions/:id/capabilities/recovery-requests', {
        preHandler: app.authenticate, schema: { params: z.object({ id }), body: z.object({
            machineId: id, dispatchToken: z.string().min(1),
            expiredCapability: z.string().regex(/^[0-9a-f]{64}$/),
        }).strict() },
    }, async (request, reply) => {
        try {
            const result = await requestExpiredCapabilityDrain({ accountId: request.userId,
                executionId: request.params.id, ...request.body });
            return reply.code(result.duplicate ? 200 : 201).send(result);
        } catch { return reply.code(409).send({ errorCode: 'CAPABILITY_RECOVERY_UNAVAILABLE' }); }
    });
    app.get('/v1/ai-team/capability-recoveries', { preHandler: app.authenticate,
        schema: { querystring: z.object({ status: z.enum(['pending', 'confirmed']).optional(),
            limit: z.coerce.number().int().min(1).max(100).optional() }) },
    }, async (request, reply) => {
        const items = await db.aiCapabilityRecoveryRequest.findMany({ where: {
            accountId: request.userId, ...(request.query.status ? {
                status: request.query.status } : {}),
        }, orderBy: { createdAt: 'desc' }, take: request.query.limit ?? 50,
        select: { id: true, executionId: true, machineId: true, status: true,
            generation: true, requestExpiresAt: true, confirmedAt: true, createdAt: true } });
        return reply.send({ items });
    });
    app.get('/v1/ai-team/capability-recoveries/:id/audit', {
        preHandler: app.authenticate, schema: { params: z.object({ id }) },
    }, async (request, reply) => {
        const row = await db.aiCapabilityRecoveryRequest.findFirst({ where: {
            id: request.params.id, accountId: request.userId },
            select: { id: true, generation: true,
                audit: { orderBy: { createdAt: 'asc' },
                    select: { generation: true, action: true,
                        actorAccountId: true, createdAt: true } } } });
        if (!row) return reply.code(404).send({ errorCode: 'CAPABILITY_RECOVERY_NOT_FOUND' });
        return reply.send({ id: row.id, generation: row.generation,
            audit: row.audit.map(item => ({ ...item,
                action: item.action.startsWith('claimed:') ? 'claimed'
                    : item.action.startsWith('human_verified:') ? 'human_verified'
                        : item.action })) });
    });
    app.post('/v1/ai-team/capability-recoveries/:id/confirmation/options', {
        preHandler: app.authenticate, schema: { params: z.object({ id }),
            body: z.object({ generation: z.number().int().positive() }).strict() },
    }, async (request, reply) => {
        try { return reply.code(201).send(await beginHumanRecoveryConfirmation({
            accountId: request.userId, recoveryId: request.params.id,
            generation: request.body.generation,
        })); }
        catch { return reply.code(409).send({ errorCode: 'HUMAN_CONFIRMATION_UNAVAILABLE' }); }
    });
    app.post('/v1/ai-team/capability-recoveries/:id/confirm', {
        preHandler: app.authenticate, schema: { params: z.object({ id }), body: z.object({
            confirmation: z.literal('drain_failed_execution'),
            generation: z.number().int().positive(), challengeId: id,
            assertion: webauthnAssertion,
        }).strict() },
    }, async (request, reply) => {
        try {
            return reply.send(await confirmExpiredCapabilityDrain({ accountId: request.userId,
                recoveryId: request.params.id, generation: request.body.generation,
                challengeId: request.body.challengeId,
                response: request.body.assertion as unknown as AuthenticationResponseJSON }));
        } catch { return reply.code(409).send({ errorCode: 'CAPABILITY_RECOVERY_UNAVAILABLE' }); }
    });
    app.post('/v1/ai-team/capability-recoveries/:id/claim', {
        preHandler: app.authenticate, schema: { params: z.object({ id }), body: z.object({
            executionId: id, machineId: id, dispatchToken: z.string().min(1),
            expiredCapability: z.string().regex(/^[0-9a-f]{64}$/),
            generation: z.number().int().positive().optional(),
        }).strict() },
    }, async (request, reply) => {
        const candidate = await db.aiCapabilityRecoveryRequest.findFirst({ where: {
            id: request.params.id, accountId: request.userId,
            executionId: request.body.executionId, machineId: request.body.machineId,
            status: 'confirmed',
        }, select: { id: true } });
        if (!candidate) return reply.code(409).send({ errorCode: 'CAPABILITY_RECOVERY_UNAVAILABLE' });
        const nonce = randomUUID();
        try {
            const features = await invokeUserRpc(request.userId,
                `${request.body.machineId}:orchestrator-features`,
                { nonce, protocolVersion: 1 }, 3_000) as any;
            if (features?.nonce !== nonce || features?.machineId !== request.body.machineId
                || features?.protocolVersion !== 1
                || features?.executionCapabilityVersion !== 1) {
                throw new Error('Machine recovery proof failed');
            }
            const result = await claimExpiredCapabilityDrain({ accountId: request.userId,
                recoveryId: request.params.id, ...request.body });
            return reply.code(201).send(result);
        } catch { return reply.code(409).send({ errorCode: 'CAPABILITY_RECOVERY_UNAVAILABLE' }); }
    });
}

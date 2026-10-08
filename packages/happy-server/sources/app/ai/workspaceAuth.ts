import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { verifyHumanRecoveryConfirmationTx } from './humanPresence';

export type WorkspaceOperation = 'view' | 'run' | 'approve' | 'admin';
export type WorkspaceResource = { kind: 'project' | 'agent'; id: string };

export async function ensureOwnerWorkspace(accountId: string) {
    const workspace = await db.aiWorkspace.upsert({ where: { ownerAccountId: accountId },
        create: { ownerAccountId: accountId, name: 'My workspace' }, update: {} });
    await db.aiWorkspaceMembership.upsert({ where: { workspaceId_memberAccountId: {
        workspaceId: workspace.id, memberAccountId: accountId,
    } }, create: { workspaceId: workspace.id, memberAccountId: accountId, role: 'owner' },
    update: { role: 'owner' } });
    return workspace;
}

export async function authorizeWorkspace(accountId: string, workspaceId: string,
    operation: WorkspaceOperation, resource?: WorkspaceResource) {
    const membership = await db.aiWorkspaceMembership.findUnique({ where: {
        workspaceId_memberAccountId: { workspaceId, memberAccountId: accountId },
    }, include: { workspace: true } });
    if (!membership) return null;
    const role = membership.role;
    if (role === 'owner' || role === 'admin') return membership.workspace;
    if (role !== 'member' || operation === 'admin' || !resource) return null;
    const grant = await db.aiWorkspaceGrant.findUnique({ where: {
        workspaceId_memberAccountId_resourceKind_resourceId: {
            workspaceId, memberAccountId: accountId, resourceKind: resource.kind,
            resourceId: resource.id,
        },
    } });
    if (!grant || !(operation === 'view' && grant.canView
        || operation === 'run' && grant.canRun
        || operation === 'approve' && grant.canApprove)) return null;
    return membership.workspace;
}

export async function authorizeWorkItemTx(tx: Prisma.TransactionClient, input: {
    actorAccountId: string; workItemId: string; operation: 'view' | 'run' | 'approve';
}) {
    const work = await tx.aiWorkItem.findUnique({ where: { id: input.workItemId }, select: {
        id: true, accountId: true, projectId: true, assigneeId: true, teamId: true,
        conversationId: true, orchestratorRunId: true, orchestratorTaskId: true,
    } });
    if (!work) return null;
    const workspace = await tx.aiWorkspace.findUnique({ where: {
        ownerAccountId: work.accountId,
    }, select: { id: true, ownerAccountId: true } });
    if (!workspace) return input.actorAccountId === work.accountId
        ? { work, workspaceId: null } : null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AiWorkspace" WHERE id=${workspace.id} FOR UPDATE`;
    if (locked.length !== 1) return null;
    const membership = await tx.aiWorkspaceMembership.findUnique({ where: {
        workspaceId_memberAccountId: { workspaceId: workspace.id,
            memberAccountId: input.actorAccountId },
    }, select: { role: true } });
    if (!membership) return null;
    if (membership.role === 'owner' || membership.role === 'admin') {
        return { work, workspaceId: workspace.id };
    }
    if (membership.role !== 'member') return null;
    const resources = [{ resourceKind: 'agent', resourceId: work.assigneeId },
        ...(work.projectId ? [{ resourceKind: 'project', resourceId: work.projectId }] : [])];
    for (const resource of resources) {
        const grant = await tx.aiWorkspaceGrant.findUnique({ where: {
            workspaceId_memberAccountId_resourceKind_resourceId: {
                workspaceId: workspace.id, memberAccountId: input.actorAccountId,
                ...resource,
            },
        }, select: { canView: true, canRun: true, canApprove: true } });
        if (!grant?.canView || input.operation === 'run' && !grant.canRun
            || input.operation === 'approve' && !grant.canApprove) return null;
    }
    return { work, workspaceId: workspace.id };
}

export async function issueExecutionCapability(input: { accountId: string; executionId: string;
    allowedOps: Array<'finish' | 'skill_download' | 'delegate' | 'event' | 'usage' | 'decision_request'>;
    expiresAt: Date }) {
    const workspace = await ensureOwnerWorkspace(input.accountId);
    const execution = await db.orchestratorExecution.findFirst({ where: { id: input.executionId,
        run: { accountId: input.accountId } }, include: { run: { include: {
        aiWorkItem: { select: { projectId: true, projectVersion: true } },
    } } } });
    if (!execution || execution.capabilityProtocolVersion !== 0
        || !['queued', 'dispatching', 'running'].includes(execution.status)
        || input.expiresAt <= new Date() || input.expiresAt.getTime() > Date.now() + 60 * 60_000) {
        throw new Error('Execution capability scope is unavailable');
    }
    const token = randomBytes(32).toString('hex');
    const row = await db.aiExecutionCapability.create({ data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        workspaceId: workspace.id, accountId: input.accountId,
        projectId: execution.run.aiWorkItem?.projectId ?? null,
        projectVersion: execution.run.aiWorkItem?.projectVersion ?? null,
        runId: execution.runId, taskId: execution.taskId,
        executionId: execution.id, machineId: execution.machineId,
        allowedOps: [...new Set(input.allowedOps)], authRevision: workspace.authRevision,
        expiresAt: input.expiresAt,
    } });
    return { id: row.id, token };
}

export async function provisionDispatchCapability(input: { accountId: string; executionId: string;
    dispatchToken: string; machineId: string; timeoutMs: number }) {
    const workspace = await ensureOwnerWorkspace(input.accountId);
    const token = randomBytes(32).toString('hex');
    const baseOps = ['identity', 'finish', 'skill_download', 'event', 'usage'];
    let issuedOps = baseOps;
    let expiresAt!: Date;
    await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "OrchestratorExecution"
            WHERE id=${input.executionId} FOR UPDATE`;
        const execution = await tx.orchestratorExecution.findFirst({ where: {
            id: input.executionId, dispatchToken: input.dispatchToken,
            machineId: input.machineId, status: 'dispatching',
            capabilityProtocolVersion: 0, run: { accountId: input.accountId },
        }, include: { task: { select: { collaborationRole: true,
            permissionMode: true, assignedAgentId: true } },
            run: { include: { aiWorkItem: { select: {
                projectId: true, projectVersion: true, teamId: true, assigneeId: true,
            } } } } } });
        if (!execution) throw new Error('Dispatch capability scope changed');
        const lifetimeMs = Math.min(Math.max(input.timeoutMs, 60_000), 60 * 60_000);
        const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        expiresAt = new Date(currentTime.getTime() + lifetimeMs);
        const allowedOps = [...baseOps];
        if (execution.task.permissionMode === 'approval') allowedOps.push('decision_request');
        if (execution.run.aiWorkItem?.teamId && execution.task.collaborationRole === 'leader_plan') {
            allowedOps.push('delegate');
        }
        const assignedAgentId = execution.task.assignedAgentId
            ?? execution.run.aiWorkItem?.assigneeId;
        if (assignedAgentId) await tx.$queryRaw`SELECT id FROM "AiAgent"
            WHERE id=${assignedAgentId} AND "accountId"=${input.accountId} FOR SHARE`;
        const templateAgent = assignedAgentId ? await tx.aiAgent.findFirst({ where: {
            id: assignedAgentId, accountId: input.accountId,
            archivedAt: null, enabled: true, templateVersionId: { not: null },
        }, select: { templateVersionId: true } }) : null;
        if (templateAgent?.templateVersionId && execution.run.aiWorkItem) {
            allowedOps.push('template_propose');
        }
        issuedOps = allowedOps;
        await tx.aiExecutionCapability.create({ data: {
            tokenHash: createHash('sha256').update(token).digest('hex'),
            workspaceId: workspace.id, accountId: input.accountId,
            projectId: execution.run.aiWorkItem?.projectId ?? null,
            projectVersion: execution.run.aiWorkItem?.projectVersion ?? null,
            runId: execution.runId, taskId: execution.taskId, executionId: execution.id,
            machineId: execution.machineId, allowedOps, authRevision: workspace.authRevision,
            expiresAt,
        } });
        await tx.orchestratorExecution.update({ where: { id: execution.id }, data: {
            capabilityProtocolVersion: 1, capabilityAllowedOps: allowedOps,
            templateVersionId: templateAgent?.templateVersionId ?? null,
        } });
    });
    return { token, protocolVersion: 1 as const, allowedOps: issuedOps,
        expiresAt: expiresAt.toISOString() };
}

export async function renewDispatchCapability(input: { accountId: string;
    executionId: string; machineId: string; dispatchToken: string; token: string }) {
    const nextToken = randomBytes(32).toString('hex');
    return db.$transaction(async tx => {
        await assertExecutionCapabilityTx(tx, { token: input.token, accountId: input.accountId,
            executionId: input.executionId, machineId: input.machineId, operation: 'finish' });
        const old = await tx.aiExecutionCapability.findUniqueOrThrow({ where: {
            tokenHash: createHash('sha256').update(input.token).digest('hex'),
        } });
        const execution = await tx.orchestratorExecution.findFirst({ where: {
            id: input.executionId, machineId: input.machineId,
            dispatchToken: input.dispatchToken, status: { in: ['dispatching', 'running'] },
            capabilityProtocolVersion: 1, run: { accountId: input.accountId },
        }, select: { capabilityAllowedOps: true } });
        if (!execution || old.revokedAt || old.recoveryMode !== 'standard'
            || old.allowedOps.length !== execution.capabilityAllowedOps.length
            || old.allowedOps.some(op => !execution.capabilityAllowedOps.includes(op))) {
            throw new Error('Execution capability cannot be renewed');
        }
        const renewed = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
            INSERT INTO "AiExecutionCapability" ("id", "tokenHash", "workspaceId",
                "accountId", "projectId", "projectVersion", "runId", "taskId",
                "executionId", "machineId", "allowedOps", "authRevision", "expiresAt")
            SELECT ${randomBytes(16).toString('hex')},
                ${createHash('sha256').update(nextToken).digest('hex')},
                c."workspaceId", c."accountId", c."projectId", c."projectVersion",
                c."runId", c."taskId", c."executionId", c."machineId",
                c."allowedOps", c."authRevision", clock_timestamp() + interval '1 hour'
            FROM "AiExecutionCapability" c
            JOIN "AiWorkspace" w ON w.id = c."workspaceId"
            JOIN "OrchestratorExecution" e ON e.id = c."executionId"
            JOIN "OrchestratorRun" r ON r.id = e."runId"
            WHERE c.id = ${old.id} AND c."revokedAt" IS NULL
              AND c."expiresAt" > clock_timestamp()
              AND c."authRevision" = w."authRevision"
              AND c."accountId" = ${input.accountId}
              AND c."executionId" = ${input.executionId}
              AND c."machineId" = ${input.machineId}
              AND e."dispatchToken" = ${input.dispatchToken}
              AND e."capabilityProtocolVersion" = 1
              AND e.status IN ('dispatching', 'running')
              AND r."accountId" = ${input.accountId}
            RETURNING "expiresAt"`;
        if (renewed.length !== 1) throw new Error('Execution capability expired');
        return { token: nextToken, protocolVersion: 1 as const,
            allowedOps: old.allowedOps, expiresAt: renewed[0].expiresAt.toISOString() };
    });
}

const capabilityHash = (token: string) => createHash('sha256').update(token).digest('hex');
const executionIdentityHash = (execution: { childSessionId: string | null;
    worktreePath: string | null; branchName: string | null }) =>
    createHash('sha256').update(JSON.stringify([
        execution.childSessionId, execution.worktreePath, execution.branchName,
    ])).digest('hex');

async function loadDrainScope(tx: Prisma.TransactionClient, input: {
    accountId: string; executionId: string; machineId: string;
    dispatchToken: string; expiredCapability: string;
}) {
    await tx.$queryRaw`SELECT r.id FROM "OrchestratorRun" r
        JOIN "OrchestratorExecution" e ON e."runId"=r.id
        WHERE e.id=${input.executionId} AND r."accountId"=${input.accountId}
        FOR UPDATE OF r`;
    const execution = await tx.orchestratorExecution.findFirst({ where: {
        id: input.executionId, machineId: input.machineId,
        dispatchToken: input.dispatchToken, capabilityProtocolVersion: 1,
        status: { in: ['dispatching', 'running'] },
        run: { accountId: input.accountId, status: 'running' },
    }, include: { run: { select: { accountId: true, status: true } } } });
    if (!execution || !execution.childSessionId || !execution.worktreePath
        || !execution.branchName) throw new Error('Recovery identity unavailable');
    const latest = await tx.orchestratorExecution.findFirst({ where: {
        taskId: execution.taskId }, orderBy: { attempt: 'desc' }, select: { id: true } });
    if (latest?.id !== execution.id) throw new Error('Recovery attempt changed');
    const old = await tx.aiExecutionCapability.findUnique({ where: {
        tokenHash: capabilityHash(input.expiredCapability),
    }, include: { workspace: true } });
    if (old) {
        const scope = await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null;
            authRevision: number; workspaceRevision: number; ownerAccountId: string }>>`
            SELECT c.id, c."revokedAt", c."authRevision",
                   w."authRevision" AS "workspaceRevision",
                   w."ownerAccountId"
            FROM "AiExecutionCapability" c
            JOIN "AiWorkspace" w ON w.id = c."workspaceId"
            WHERE c.id=${old.id} FOR SHARE OF c, w`;
        if (scope.length !== 1 || scope[0].revokedAt
            || scope[0].authRevision !== scope[0].workspaceRevision
            || scope[0].ownerAccountId !== input.accountId) {
            throw new Error('Recovery authorization changed');
        }
    }
    const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    if (!old || old.accountId !== input.accountId || old.executionId !== execution.id
        || old.runId !== execution.runId || old.taskId !== execution.taskId
        || old.machineId !== input.machineId || old.recoveryMode !== 'standard'
        || !old.allowedOps.includes('finish') || old.revokedAt
        || old.authRevision !== old.workspace.authRevision
        || old.workspace.ownerAccountId !== input.accountId
        || old.expiresAt > currentTime
        || old.expiresAt.getTime() < currentTime.getTime() - 24 * 60 * 60_000) {
        throw new Error('Recovery capability scope changed');
    }
    return { execution, old, currentTime, identityHash: executionIdentityHash(execution) };
}

export async function requestExpiredCapabilityDrain(input: { accountId: string;
    executionId: string; machineId: string; dispatchToken: string;
    expiredCapability: string }) {
    return db.$transaction(async tx => {
        const { execution, old, currentTime, identityHash } = await loadDrainScope(tx, input);
        const existing = await tx.aiCapabilityRecoveryRequest.findUnique({ where: {
            executionId: execution.id } });
        if (existing) {
            if (existing.expiredCapabilityId !== old.id || existing.identityHash !== identityHash
                || existing.machineId !== input.machineId
                || existing.dispatchTokenHash !== capabilityHash(input.dispatchToken)) {
                throw new Error('Recovery request changed');
            }
            const priorDrain = existing.drainCapabilityId
                ? await tx.aiExecutionCapability.findUnique({ where: {
                    id: existing.drainCapabilityId }, select: { expiresAt: true,
                        revokedAt: true } }) : null;
            const [{ currentTime: latestTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (old.expiresAt.getTime() < latestTime.getTime() - 24 * 60 * 60_000
                || priorDrain?.revokedAt) throw new Error('Recovery window closed');
            if (priorDrain && priorDrain.expiresAt <= latestTime
                || !existing.drainCapabilityId && existing.requestExpiresAt <= latestTime) {
                const generation = existing.generation + 1;
                const reopened = await tx.aiCapabilityRecoveryRequest.update({
                    where: { id: existing.id }, data: { generation,
                        status: 'pending', requestExpiresAt: new Date(latestTime.getTime() + 15 * 60_000),
                        confirmedAt: null, confirmedByAccountId: null, drainCapabilityId: null },
                });
                await tx.aiCapabilityRecoveryAudit.create({ data: {
                    recoveryId: existing.id, generation, action: 'requested',
                    actorAccountId: input.accountId,
                } });
                return { id: reopened.id, status: reopened.status,
                    generation, expiresAt: reopened.requestExpiresAt.toISOString(), duplicate: false };
            }
            if (existing.requestExpiresAt <= latestTime || existing.drainCapabilityId && !priorDrain) {
                throw new Error('Recovery request changed');
            }
            return { id: existing.id, status: existing.status,
                generation: existing.generation,
                expiresAt: existing.requestExpiresAt.toISOString(), duplicate: true };
        }
        const row = await tx.aiCapabilityRecoveryRequest.create({ data: {
            accountId: input.accountId, workspaceId: old.workspaceId,
            executionId: execution.id, machineId: input.machineId,
            dispatchTokenHash: capabilityHash(input.dispatchToken),
            expiredCapabilityId: old.id, identityHash,
            requestExpiresAt: new Date(currentTime.getTime() + 15 * 60_000),
        } });
        await tx.aiCapabilityRecoveryAudit.create({ data: {
            recoveryId: row.id, generation: row.generation,
            action: 'requested', actorAccountId: input.accountId,
        } });
        return { id: row.id, status: row.status,
            generation: row.generation,
            expiresAt: row.requestExpiresAt.toISOString(), duplicate: false };
    });
}

export async function confirmExpiredCapabilityDrain(input: { accountId: string;
    recoveryId: string; generation: number; challengeId: string;
    response: AuthenticationResponseJSON }) {
    return db.$transaction(async tx => {
        const candidate = await tx.aiCapabilityRecoveryRequest.findFirst({ where: {
            id: input.recoveryId, accountId: input.accountId } });
        if (!candidate) throw new Error('Recovery request unavailable');
        await tx.$queryRaw`SELECT r.id FROM "OrchestratorRun" r
            JOIN "OrchestratorExecution" e ON e."runId"=r.id
            WHERE e.id=${candidate.executionId} AND r."accountId"=${input.accountId}
            FOR UPDATE OF r`;
        const row = await tx.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: {
            id: candidate.id } });
        const execution = await tx.orchestratorExecution.findUniqueOrThrow({ where: {
            id: row.executionId }, include: { run: { select: { status: true,
                accountId: true } } } });
        const old = await tx.aiExecutionCapability.findUniqueOrThrow({ where: {
            id: row.expiredCapabilityId }, include: { workspace: true } });
        const scope = await tx.$queryRaw<Array<{ revokedAt: Date | null;
            authRevision: number; workspaceRevision: number; ownerAccountId: string }>>`
            SELECT c."revokedAt", c."authRevision",
                   w."authRevision" AS "workspaceRevision",
                   w."ownerAccountId"
            FROM "AiExecutionCapability" c
            JOIN "AiWorkspace" w ON w.id = c."workspaceId"
            WHERE c.id=${old.id} FOR SHARE OF c, w`;
        if (scope.length !== 1 || scope[0].revokedAt
            || scope[0].authRevision !== scope[0].workspaceRevision
            || scope[0].ownerAccountId !== input.accountId) {
            throw new Error('Recovery authorization changed');
        }
        const latest = await tx.orchestratorExecution.findFirst({ where: {
            taskId: execution.taskId }, orderBy: { attempt: 'desc' }, select: { id: true } });
        const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        if (input.generation !== row.generation
            || row.status !== 'pending' || row.requestExpiresAt <= currentTime
            || old.revokedAt || old.authRevision !== old.workspace.authRevision
            || old.workspace.ownerAccountId !== input.accountId
            || old.recoveryMode !== 'standard' || old.expiresAt > currentTime
            || latest?.id !== execution.id || execution.capabilityProtocolVersion !== 1
            || !['dispatching', 'running'].includes(execution.status)
            || execution.run.accountId !== input.accountId
            || execution.run.status !== 'running'
            || execution.machineId !== row.machineId
            || capabilityHash(execution.dispatchToken) !== row.dispatchTokenHash
            || executionIdentityHash(execution) !== row.identityHash) {
            throw new Error('Recovery scope changed');
        }
        const human = await verifyHumanRecoveryConfirmationTx(tx, {
            accountId: input.accountId, recoveryId: row.id,
            generation: row.generation, challengeId: input.challengeId,
            response: input.response,
        });
        const [{ currentTime: finalTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        const confirmed = await tx.aiCapabilityRecoveryRequest.updateMany({ where: {
            id: row.id, accountId: input.accountId, generation: input.generation,
            status: 'pending', requestExpiresAt: { gt: finalTime },
        }, data: {
            status: 'confirmed', confirmedAt: finalTime,
            confirmedByAccountId: input.accountId,
        } });
        if (confirmed.count !== 1) throw new Error('Recovery confirmation expired');
        await tx.aiCapabilityRecoveryAudit.create({ data: {
            recoveryId: row.id, generation: row.generation,
            action: `human_verified:${human.credentialHash.slice(0, 16)}`,
            actorAccountId: input.accountId,
        } });
        await tx.aiCapabilityRecoveryAudit.create({ data: {
            recoveryId: row.id, generation: row.generation,
            action: 'confirmed', actorAccountId: input.accountId,
        } });
        return { id: row.id, status: 'confirmed', generation: row.generation, duplicate: false };
    }, { timeout: 10_000 });
}

export async function claimExpiredCapabilityDrain(input: { accountId: string;
    recoveryId: string; executionId: string; machineId: string;
    dispatchToken: string; expiredCapability: string; generation?: number }) {
    const nextToken = randomBytes(32).toString('hex');
    return db.$transaction(async tx => {
        const { execution, old, currentTime, identityHash } = await loadDrainScope(tx, input);
        const row = await tx.aiCapabilityRecoveryRequest.findUnique({ where: {
            id: input.recoveryId } });
        if (!row || (input.generation ?? 1) !== row.generation
            || row.status !== 'confirmed' || row.accountId !== input.accountId
            || row.executionId !== execution.id || row.machineId !== input.machineId
            || row.expiredCapabilityId !== old.id || row.identityHash !== identityHash
            || row.dispatchTokenHash !== capabilityHash(input.dispatchToken)
            || row.requestExpiresAt <= currentTime) {
            throw new Error('Recovery confirmation unavailable');
        }
        const proofs = await tx.aiCapabilityRecoveryAudit.findMany({ where: {
            recoveryId: row.id, generation: row.generation,
            action: { startsWith: 'human_verified:' },
        }, select: { action: true } });
        const credentials = await tx.aiHumanCredential.findMany({ where: {
            accountId: input.accountId, status: 'trusted', revokedAt: null,
        }, select: { id: true, credentialId: true } });
        const matching = credentials.find(credential => proofs.some(proof =>
            proof.action === `human_verified:${capabilityHash(credential.credentialId).slice(0, 16)}`));
        if (!matching) throw new Error('Recovery human credential unavailable');
        const trusted = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "AiHumanCredential"
            WHERE id=${matching.id} AND "accountId"=${input.accountId}
              AND status='trusted' AND "revokedAt" IS NULL FOR SHARE`;
        if (trusted.length !== 1) throw new Error('Recovery human credential revoked');
        const issued = await tx.$queryRaw<Array<{ id: string; expiresAt: Date }>>`
            INSERT INTO "AiExecutionCapability" ("id", "tokenHash", "workspaceId",
                "accountId", "projectId", "projectVersion", "runId", "taskId",
                "executionId", "machineId", "allowedOps", "recoveryMode",
                "authRevision", "expiresAt")
            SELECT ${randomBytes(16).toString('hex')}, ${capabilityHash(nextToken)},
                c."workspaceId", c."accountId", c."projectId", c."projectVersion",
                c."runId", c."taskId", c."executionId", c."machineId",
                ARRAY['finish','event','usage']::TEXT[], 'drain', c."authRevision",
                clock_timestamp() + interval '10 minutes'
            FROM "AiCapabilityRecoveryRequest" rr
            JOIN "AiExecutionCapability" c ON c.id = rr."expiredCapabilityId"
            JOIN "AiWorkspace" w ON w.id = c."workspaceId"
            JOIN "OrchestratorExecution" e ON e.id = rr."executionId"
            JOIN "OrchestratorRun" r ON r.id = e."runId"
            WHERE rr.id = ${row.id} AND rr.status = 'confirmed'
              AND rr.generation = ${row.generation}
              AND EXISTS (SELECT 1 FROM "AiCapabilityRecoveryAudit" proof
                  WHERE proof."recoveryId" = rr.id
                    AND proof.generation = rr.generation
                    AND proof.action LIKE 'human_verified:%')
              AND rr."requestExpiresAt" > clock_timestamp()
              AND (rr."drainCapabilityId" IS NULL OR EXISTS (
                  SELECT 1 FROM "AiExecutionCapability" prior
                  WHERE prior.id = rr."drainCapabilityId"
                    AND prior."expiresAt" > clock_timestamp()
                    AND prior."revokedAt" IS NULL))
              AND rr."accountId" = ${input.accountId}
              AND rr."machineId" = ${input.machineId}
              AND rr."executionId" = ${input.executionId}
              AND rr."dispatchTokenHash" = ${capabilityHash(input.dispatchToken)}
              AND rr."identityHash" = ${identityHash}
              AND c.id = ${old.id} AND c."tokenHash" = ${capabilityHash(input.expiredCapability)}
              AND c."revokedAt" IS NULL AND c."recoveryMode" = 'standard'
              AND c."expiresAt" <= clock_timestamp()
              AND c."expiresAt" > clock_timestamp() - interval '24 hours'
              AND c."authRevision" = w."authRevision"
              AND w."ownerAccountId" = ${input.accountId}
              AND c."accountId" = ${input.accountId}
              AND c."executionId" = e.id AND c."runId" = e."runId"
              AND c."taskId" = e."taskId" AND c."machineId" = e."machineId"
              AND e."machineId" = ${input.machineId}
              AND e."dispatchToken" = ${input.dispatchToken}
              AND e."capabilityProtocolVersion" = 1
              AND e.status IN ('dispatching', 'running')
              AND r."accountId" = ${input.accountId} AND r.status = 'running'
              AND NOT EXISTS (SELECT 1 FROM "OrchestratorExecution" newer
                  WHERE newer."taskId" = e."taskId" AND newer.attempt > e.attempt)
            RETURNING id, "expiresAt"`;
        if (issued.length !== 1) throw new Error('Recovery claim expired');
        if (row.drainCapabilityId) await tx.aiExecutionCapability.updateMany({ where: {
            id: row.drainCapabilityId, revokedAt: null },
        data: { revokedAt: currentTime } });
        await tx.aiCapabilityRecoveryRequest.update({ where: { id: row.id },
            data: { drainCapabilityId: issued[0].id } });
        const claimOrdinal = await tx.aiCapabilityRecoveryAudit.count({ where: {
            recoveryId: row.id, generation: row.generation,
            action: { startsWith: 'claimed:' },
        } }) + 1;
        await tx.aiCapabilityRecoveryAudit.create({ data: {
            recoveryId: row.id, generation: row.generation,
            action: `claimed:${claimOrdinal}`, actorAccountId: input.accountId,
        } });
        return { token: nextToken, protocolVersion: 1 as const,
            allowedOps: ['finish', 'event', 'usage'],
            expiresAt: issued[0].expiresAt.toISOString(),
            recoveryMode: 'drain' as const, generation: row.generation };
    });
}

export async function verifyExecutionCapability(input: { token: string; accountId: string;
    executionId: string; machineId: string; operation: string }) {
    if (!/^[0-9a-f]{64}$/.test(input.token)) return false;
    const row = await db.aiExecutionCapability.findUnique({ where: { tokenHash:
        createHash('sha256').update(input.token).digest('hex') }, include: { workspace: true } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()
        || row.accountId !== input.accountId || row.executionId !== input.executionId
        || row.machineId !== input.machineId || !row.allowedOps.includes(input.operation)
        || row.authRevision !== row.workspace.authRevision) return false;
    const execution = await db.orchestratorExecution.findFirst({ where: { id: row.executionId,
        runId: row.runId, taskId: row.taskId, machineId: row.machineId,
        run: { accountId: row.accountId } }, select: { status: true } });
    return Boolean(execution && (['queued', 'dispatching', 'running'].includes(execution.status)
        || input.operation === 'finish' && ['completed', 'failed', 'cancelled'].includes(execution.status)
        || input.operation === 'usage' && ['completed', 'failed', 'cancelled'].includes(execution.status)));
}

export async function assertExecutionCapabilityTx(tx: Prisma.TransactionClient, input: {
    token: string; accountId: string; executionId: string; machineId: string;
    operation: string }) {
    if (!/^[0-9a-f]{64}$/.test(input.token)) throw new Error('Capability is invalid');
    const hash = createHash('sha256').update(input.token).digest('hex');
    const rows = await tx.$queryRaw<Array<{ id: string; allowedOps: string[];
        expiresAt: Date; revokedAt: Date | null; authRevision: number;
        workspaceRevision: number }>>`
        SELECT c.id, c."allowedOps", c."expiresAt", c."revokedAt",
               c."authRevision", w."authRevision" AS "workspaceRevision"
        FROM "AiExecutionCapability" c
        JOIN "AiWorkspace" w ON w.id = c."workspaceId"
        JOIN "OrchestratorExecution" e ON e.id = c."executionId"
        JOIN "OrchestratorRun" r ON r.id = e."runId"
        WHERE c."tokenHash" = ${hash} AND c."accountId" = ${input.accountId}
          AND c."executionId" = ${input.executionId}
          AND c."machineId" = ${input.machineId}
          AND c."runId" = e."runId" AND c."taskId" = e."taskId"
          AND c."machineId" = e."machineId" AND r."accountId" = ${input.accountId}
          AND (e.status IN ('queued', 'dispatching', 'running')
            OR (${input.operation} = 'finish' AND e.status IN ('completed', 'failed', 'cancelled'))
            OR (${input.operation} = 'usage' AND e.status IN ('completed', 'failed', 'cancelled')))
        FOR UPDATE OF c, w, e`;
    const clock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    const row = rows[0];
    if (rows.length !== 1 || !row.allowedOps.includes(input.operation)
        || row.revokedAt || row.expiresAt <= clock[0].currentTime
        || row.authRevision !== row.workspaceRevision) {
        throw new Error('Capability scope is unavailable');
    }
    return row.id;
}

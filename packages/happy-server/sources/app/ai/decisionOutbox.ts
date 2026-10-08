import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { hasUserRpcMethod, invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';

const LEASE_MS = 30_000;

export async function decisionOutboxTick(now = new Date(), accountId?: string) {
    await db.aiDecisionRequest.updateMany({ where: {
        ...(accountId ? { accountId } : {}), status: 'pending', expiresAt: { lte: now },
    }, data: { status: 'expired' } });
    const rows = await db.aiDecisionRequest.findMany({ where: {
        ...(accountId ? { accountId } : {}),
        status: 'decided',
        OR: [{ deliveryStatus: 'pending', nextAttemptAt: { lte: now } },
            { deliveryStatus: 'processing', leaseUntil: { lt: now } }],
    }, orderBy: { createdAt: 'asc' }, take: 20 });
    for (const row of rows) {
        const method = `${row.machineId}:orchestrator-decision`;
        if (!hasUserRpcMethod(row.accountId, method)) continue;
        const owner = randomUUID();
        const claimed = await db.aiDecisionRequest.updateMany({ where: { id: row.id,
            deliveryStatus: row.deliveryStatus,
            ...(row.deliveryStatus === 'processing' ? { leaseUntil: { lt: now } }
                : { nextAttemptAt: { lte: now } }),
        }, data: { deliveryStatus: 'processing', claimOwner: owner,
            leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } } });
        if (!claimed.count) continue;
        const membership = row.decidedBy ? await db.aiWorkspaceMembership.findUnique({ where: {
            workspaceId_memberAccountId: { workspaceId: row.workspaceId,
                memberAccountId: row.decidedBy },
        } }) : null;
        const work = await db.aiWorkItem.findFirst({ where: { id: row.workItemId,
            accountId: row.accountId, orchestratorRunId: row.runId },
        select: { projectId: true, assigneeId: true } });
        const grant = membership?.role === 'member' && work ? await db.aiWorkspaceGrant.findFirst({
            where: { workspaceId: row.workspaceId, memberAccountId: row.decidedBy!,
                canApprove: true, OR: [
                    { resourceKind: 'agent', resourceId: work.assigneeId },
                    ...(work.projectId ? [{ resourceKind: 'project', resourceId: work.projectId }] : []),
                ] }, select: { resourceId: true },
        }) : null;
        if (!work || !membership || (membership.role !== 'owner'
            && membership.role !== 'admin' && !grant)) {
            await db.aiDecisionRequest.updateMany({ where: { id: row.id,
                claimOwner: owner, deliveryStatus: 'processing' },
            data: { deliveryStatus: 'blocked', claimOwner: null,
                leaseUntil: null, errorCode: 'approver_revoked' } });
            continue;
        }
        // Keep the workspace authorization lock until the runtime acknowledgement is recorded.
        // Membership revocation and decision delivery then have one observable order.
        await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "AiWorkspace" WHERE id=${row.workspaceId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "AiDecisionRequest" WHERE id=${row.id} FOR UPDATE`;
            const current = await tx.aiDecisionRequest.findUnique({ where: { id: row.id } });
            if (!current || current.claimOwner !== owner || current.deliveryStatus !== 'processing'
                || current.version !== row.version || current.status !== 'decided') return;
            const clock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            const block = async (errorCode: string) => tx.aiDecisionRequest.updateMany({
                where: { id: row.id, claimOwner: owner, deliveryStatus: 'processing',
                    version: row.version },
                data: { deliveryStatus: 'blocked', claimOwner: null,
                    leaseUntil: null, errorCode },
            });
            if (current.expiresAt <= clock[0].currentTime) {
                await block('decision_expired');
                return;
            }
            const currentMember = current.decidedBy ? await tx.aiWorkspaceMembership.findUnique({
                where: { workspaceId_memberAccountId: { workspaceId: row.workspaceId,
                    memberAccountId: current.decidedBy } },
            }) : null;
            const currentWork = await tx.aiWorkItem.findFirst({ where: { id: row.workItemId,
                accountId: row.accountId, orchestratorRunId: row.runId },
                select: { projectId: true, assigneeId: true } });
            const currentGrant = currentMember?.role === 'member' && currentWork
                ? await tx.aiWorkspaceGrant.findFirst({ where: {
                    workspaceId: row.workspaceId, memberAccountId: current.decidedBy!,
                    canApprove: true, OR: [
                        { resourceKind: 'agent', resourceId: currentWork.assigneeId },
                        ...(currentWork.projectId ? [{ resourceKind: 'project',
                            resourceId: currentWork.projectId }] : []),
                    ],
                }, select: { resourceId: true } }) : null;
            // The membership read can wait on another connection. Recheck the lease
            // using the database wall clock after every such wait, before the RPC.
            const dispatchClock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (!current.leaseUntil || current.leaseUntil <= dispatchClock[0].currentTime) {
                await tx.aiDecisionRequest.updateMany({ where: { id: row.id,
                    claimOwner: owner, deliveryStatus: 'processing', version: row.version },
                data: { deliveryStatus: 'pending', claimOwner: null,
                    leaseUntil: null, nextAttemptAt: dispatchClock[0].currentTime,
                    errorCode: 'claim_expired' } });
                return;
            }
            if (current.expiresAt <= dispatchClock[0].currentTime) {
                await block('decision_expired');
                return;
            }
            if (!currentWork || !currentMember || currentMember.role === 'member' && !currentGrant) {
                await block('approver_revoked');
                return;
            }
            const execution = await tx.orchestratorExecution.findFirst({ where: {
                id: row.executionId, runId: row.runId, taskId: row.taskId,
                machineId: row.machineId, status: 'running',
                run: { accountId: row.accountId },
            }, select: { dispatchToken: true, childSessionId: true,
                worktreePath: true, branchName: true } });
            if (!execution || createHash('sha256').update(execution.dispatchToken).digest('hex')
                !== row.dispatchTokenHash || row.operationId && (
                    !row.actionHash || !row.actionType
                    || execution.childSessionId !== row.childSessionId
                    || execution.branchName !== row.branchName
                    || !execution.worktreePath
                    || createHash('sha256').update(execution.worktreePath).digest('hex')
                        !== row.worktreePathHash)) {
                await block('execution_changed');
                return;
            }
            const finalDispatchClock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (!current.leaseUntil || current.leaseUntil <= finalDispatchClock[0].currentTime) {
                await tx.aiDecisionRequest.updateMany({ where: { id: row.id,
                    claimOwner: owner, deliveryStatus: 'processing', version: row.version },
                data: { deliveryStatus: 'pending', claimOwner: null,
                    leaseUntil: null, nextAttemptAt: finalDispatchClock[0].currentTime,
                    errorCode: 'claim_expired' } });
                return;
            }
            if (current.expiresAt <= finalDispatchClock[0].currentTime) {
                await block('decision_expired');
                return;
            }
            let accepted = false;
            let errorCode = 'runtime_rejected';
            try {
                const result = await invokeUserRpc(row.accountId, method, {
                    decisionId: row.id, executionId: row.executionId,
                    dispatchToken: execution.dispatchToken, version: current.version,
                    decision: current.decision, note: current.note,
                    operationId: row.operationId, actionType: row.actionType,
                    actionHash: row.actionHash, childSessionId: row.childSessionId,
                    worktreePathHash: row.worktreePathHash, branchName: row.branchName,
                    expiresAt: current.expiresAt.toISOString(),
                }, 15_000) as { accepted?: boolean };
                accepted = result?.accepted === true;
            } catch { errorCode = 'rpc_failed'; }
            const attempts = current.attempts;
            const ackClock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (!current.leaseUntil || current.leaseUntil <= ackClock[0].currentTime) {
                await tx.aiDecisionRequest.updateMany({ where: { id: row.id,
                    claimOwner: owner, deliveryStatus: 'processing', version: row.version },
                data: { deliveryStatus: 'pending', claimOwner: null, leaseUntil: null,
                    nextAttemptAt: ackClock[0].currentTime, errorCode: 'claim_expired' } });
                return;
            }
            await tx.aiDecisionRequest.updateMany({ where: { id: row.id,
                claimOwner: owner, deliveryStatus: 'processing', version: row.version,
                leaseUntil: { gt: ackClock[0].currentTime } },
            data: accepted ? { deliveryStatus: 'delivered', claimOwner: null,
                leaseUntil: null, deliveredAt: new Date(), errorCode: null }
                : { deliveryStatus: attempts >= 12 ? 'blocked' : 'pending',
                    claimOwner: null, leaseUntil: null, errorCode,
                    nextAttemptAt: new Date(Date.now() + Math.min(5_000 * 2 ** attempts, 600_000)) } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 25_000 });
    }
}

export function startDecisionOutbox() {
    forever('ai-decision-outbox', async () => {
        try { await decisionOutboxTick(); }
        catch { warn({ module: 'ai-decision-outbox' }, 'Decision outbox tick failed'); }
        await delay(5_000, shutdownSignal);
    });
}

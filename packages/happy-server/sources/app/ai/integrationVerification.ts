import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { hasUserRpcMethod, invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { addTaskCount, createEmptySummaryInternal, deriveRunStatus, isRunTerminal } from '@/app/orchestrator/state';
import { delay } from '@/utils/delay';
import { forever } from '@/utils/forever';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';
import { integrationExpectedHash } from './integrationHash';

const LEASE_MS = 45_000;
const MAX_ATTEMPTS = 12;

export async function integrationVerificationTick(now = new Date(), accountId?: string): Promise<void> {
    const rows = await db.aiIntegrationVerification.findMany({ where: {
        ...(accountId ? { accountId } : {}),
        OR: [{ status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'processing', leaseUntil: { lt: now } }],
    }, orderBy: { createdAt: 'asc' }, take: 20 });
    await Promise.all(rows.map(async (row) => {
        const method = `${row.machineId}:orchestrator-verify-integration`;
        if (!hasUserRpcMethod(row.accountId, method)) return;
        const owner = randomUUID();
        const claimed = await db.aiIntegrationVerification.updateMany({ where: {
            executionId: row.executionId, status: row.status,
            ...(row.status === 'processing' ? { leaseUntil: { lt: now } } : { nextAttemptAt: { lte: now } }),
        }, data: { status: 'processing', claimOwner: owner,
            leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } } });
        if (!claimed.count) return;
        let verified = false;
        let errorCode = 'rpc_failed';
        let dispatchedToken: string | null = null;
        try {
            const execution = await db.orchestratorExecution.findFirst({ where: {
                id: row.executionId, taskId: row.taskId, runId: row.runId, machineId: row.machineId,
                run: { accountId: row.accountId },
            }, select: { dispatchToken: true, status: true } });
            const expectedHash = integrationExpectedHash(row.expected);
            if (!execution || execution.status !== 'completed' || expectedHash !== row.expectedHash) {
                errorCode = 'identity_changed';
            } else {
                const claim = await db.aiIntegrationVerification.findUnique({ where: {
                    executionId: row.executionId }, select: { claimOwner: true, status: true,
                    leaseUntil: true, expectedHash: true } });
                const latest = await db.orchestratorExecution.findFirst({ where: {
                    taskId: row.taskId }, orderBy: { attempt: 'desc' }, select: { id: true } });
                const beforeRpc = await db.$queryRaw<Array<{ currentTime: Date }>>`
                    SELECT clock_timestamp() AS "currentTime"`;
                if (claim?.claimOwner !== owner || claim.status !== 'processing'
                    || claim.expectedHash !== row.expectedHash || !claim.leaseUntil
                    || claim.leaseUntil <= beforeRpc[0].currentTime
                    || latest?.id !== row.executionId) {
                    errorCode = 'claim_expired';
                } else {
                dispatchedToken = execution.dispatchToken;
                const response = await invokeUserRpc(row.accountId, method, {
                    executionId: row.executionId, dispatchToken: execution.dispatchToken,
                    expectedHash: row.expectedHash, expected: row.expected, proof: row.proof,
                }, 30_000) as { verified?: boolean; expectedHash?: string; errorCode?: string };
                verified = response?.verified === true && response.expectedHash === row.expectedHash;
                errorCode = verified ? '' : response?.errorCode?.slice(0, 100) || 'runtime_rejected';
                }
            }
        } catch { errorCode = 'rpc_failed'; }
        const blocked = ['identity_changed', 'conflict', 'patch_missing', 'file_mismatch'].includes(errorCode)
            || row.attempts + 1 >= MAX_ATTEMPTS;
        await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "OrchestratorRun"
                WHERE id=${row.runId} AND "accountId"=${row.accountId} FOR UPDATE`;
            await tx.$queryRaw`SELECT "executionId" FROM "AiIntegrationVerification"
                WHERE "executionId"=${row.executionId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "OrchestratorTask"
                WHERE id=${row.taskId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "OrchestratorExecution"
                WHERE id=${row.executionId} FOR UPDATE`;
            const current = await tx.aiIntegrationVerification.findUnique({ where: {
                executionId: row.executionId } });
            if (!current || current.claimOwner !== owner || current.status !== 'processing') return;
            const [execution, task, currentRun, latest] = await Promise.all([
                tx.orchestratorExecution.findUnique({ where: { id: row.executionId },
                    select: { runId: true, taskId: true, machineId: true,
                        status: true, dispatchToken: true } }),
                tx.orchestratorTask.findUnique({ where: { id: row.taskId },
                    select: { runId: true, status: true } }),
                tx.orchestratorRun.findUnique({ where: { id: row.runId },
                    select: { accountId: true, status: true } }),
                tx.orchestratorExecution.findFirst({ where: { taskId: row.taskId },
                    orderBy: { attempt: 'desc' }, select: { id: true } }),
            ]);
            const clock = await tx.$queryRaw<Array<{ currentTime: Date }>>`
                SELECT clock_timestamp() AS "currentTime"`;
            if (!current.leaseUntil || current.leaseUntil <= clock[0].currentTime) {
                await tx.aiIntegrationVerification.updateMany({ where: {
                    executionId: row.executionId, claimOwner: owner, status: 'processing',
                }, data: { status: 'pending', claimOwner: null, leaseUntil: null,
                    nextAttemptAt: clock[0].currentTime, errorCode: 'claim_expired' } });
                return;
            }
            if (current.expectedHash !== row.expectedHash
                || integrationExpectedHash(current.expected) !== row.expectedHash
                || !execution || execution.runId !== row.runId || execution.taskId !== row.taskId
                || latest?.id !== row.executionId
                || execution.machineId !== row.machineId || execution.status !== 'completed'
                || dispatchedToken && execution.dispatchToken !== dispatchedToken
                || !task || task.runId !== row.runId || task.status !== 'running'
                || !currentRun || currentRun.accountId !== row.accountId
                || currentRun.status !== 'running') {
                await tx.aiIntegrationVerification.updateMany({ where: {
                    executionId: row.executionId, claimOwner: owner, status: 'processing',
                }, data: { status: 'blocked', claimOwner: null,
                    leaseUntil: null, errorCode: 'identity_changed' } });
                return;
            }
            const updated = await tx.aiIntegrationVerification.updateMany({ where: {
                executionId: row.executionId, claimOwner: owner, status: 'processing',
                expectedHash: row.expectedHash, leaseUntil: { gt: clock[0].currentTime },
            }, data: verified ? {
                status: 'verified', verifiedAt: new Date(), claimOwner: null,
                leaseUntil: null, errorCode: null,
            } : {
                status: blocked ? 'blocked' : 'pending', claimOwner: null, leaseUntil: null,
                nextAttemptAt: new Date(now.getTime() + Math.min(5_000 * 2 ** (row.attempts + 1), 600_000)),
                errorCode,
            } });
            if (!updated.count || (!verified && !blocked)) return;
            await tx.orchestratorTask.updateMany({ where: { id: row.taskId, runId: row.runId, status: 'running' },
                data: { status: verified ? 'completed' : 'failed',
                    errorCode: verified ? null : 'INTEGRATION_VERIFICATION_FAILED',
                    errorMessage: verified ? null : errorCode } });
            const grouped = await tx.orchestratorTask.groupBy({ by: ['status'], where: { runId: row.runId },
                _count: { _all: true } });
            const summary = createEmptySummaryInternal();
            for (const item of grouped) addTaskCount(summary, item.status, item._count._all);
            const run = await tx.orchestratorRun.findFirst({ where: { id: row.runId, accountId: row.accountId },
                select: { status: true } });
            if (!run) return;
            const status = deriveRunStatus(run.status, summary);
            await tx.orchestratorRun.update({ where: { id: row.runId }, data: {
                status, completedAt: isRunTerminal(status) ? new Date() : null,
            } });
            if (!verified) await tx.aiWorkItem.updateMany({ where: { accountId: row.accountId,
                orchestratorTaskId: row.taskId }, data: {
                deliveryVerificationStatus: 'blocked', deliveryVerificationErrorCode: errorCode,
                requiresDecision: true,
            } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }));
}

export function startIntegrationVerificationWorker(): void {
    forever('ai-integration-verification', async () => {
        try { await integrationVerificationTick(); }
        catch { warn({ module: 'ai-integration-verification' }, 'Integration verification tick failed'); }
        await delay(5_000, shutdownSignal);
    });
}

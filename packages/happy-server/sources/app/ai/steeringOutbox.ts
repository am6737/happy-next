import { randomUUID } from 'node:crypto';
import { db } from '@/storage/db';
import { hasUserRpcMethod, invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';

const INTERVAL_MS = 5_000;
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 12;

export async function steeringOutboxTick(now = new Date(), accountId?: string): Promise<void> {
    const rows = await db.aiSteeringMessage.findMany({ where: {
        ...(accountId ? { accountId } : {}),
        OR: [{ status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'processing', leaseUntil: { lt: now } }],
    }, orderBy: { createdAt: 'asc' }, take: 20 });
    await Promise.all(rows.map(async (row) => {
        const localExecution = await db.orchestratorExecution.findFirst({ where: {
            taskId: row.targetTaskId, status: 'running', run: { accountId: row.accountId },
        }, orderBy: { attempt: 'desc' }, select: { machineId: true } });
        if (localExecution && !hasUserRpcMethod(row.accountId, `${localExecution.machineId}:orchestrator-steer`)) return;
        const owner = randomUUID();
        const claimed = await db.aiSteeringMessage.updateMany({ where: { id: row.id,
            accountId: row.accountId, status: row.status,
            ...(row.status === 'processing' ? { leaseUntil: { lt: now } } : { nextAttemptAt: { lte: now } }),
        }, data: { status: 'processing', claimOwner: owner,
            leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } } });
        if (!claimed.count) return;
        const execution = await db.orchestratorExecution.findFirst({ where: {
            taskId: row.targetTaskId, status: 'running', run: { accountId: row.accountId },
        }, orderBy: { attempt: 'desc' }, select: { id: true, machineId: true, dispatchToken: true } });
        if (!execution) {
            await db.aiSteeringMessage.updateMany({ where: { id: row.id, claimOwner: owner },
                data: { status: 'blocked', claimOwner: null, leaseUntil: null, errorCode: 'target_finished' } });
            return;
        }
        const method = `${execution.machineId}:orchestrator-steer`;
        let accepted = false;
        let errorCode = 'runtime_unavailable';
        if (hasUserRpcMethod(row.accountId, method)) {
            try {
                const response = await invokeUserRpc(row.accountId, method, {
                    steeringId: row.id, executionId: execution.id, dispatchToken: execution.dispatchToken,
                    message: row.text,
                }, 15_000) as { accepted?: boolean };
                accepted = response?.accepted === true;
                if (!accepted) errorCode = 'runtime_rejected';
            } catch { errorCode = 'rpc_failed'; }
        }
        const attempts = row.attempts + 1;
        const blocked = attempts >= MAX_ATTEMPTS;
        await db.aiSteeringMessage.updateMany({ where: { id: row.id, claimOwner: owner,
            status: 'processing' }, data: accepted ? {
                status: 'delivered', deliveredAt: new Date(), claimOwner: null,
                leaseUntil: null, errorCode: null,
            } : { status: blocked ? 'blocked' : 'pending', claimOwner: null, leaseUntil: null,
                nextAttemptAt: new Date(now.getTime() + Math.min(5_000 * 2 ** attempts, 600_000)), errorCode,
            } });
    }));
}

export function startSteeringOutbox(): void {
    forever('ai-steering-outbox', async () => {
        try { await steeringOutboxTick(); }
        catch { warn({ module: 'ai-steering-outbox' }, 'Steering outbox tick failed'); }
        await delay(INTERVAL_MS, shutdownSignal);
    });
}

import { TEAMMATE_RPC_RUN_CANCEL } from 'happy-wire';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { TEAMMATE_RPC_TIMEOUT_MS } from '@/app/teammate/teammateTaskTerminate';
import { teammateRunTerminateTx } from '@/app/teammate/teammateRunFinish';
import { TEAMMATE_ACTIVE_RUN_STATUSES, TEAMMATE_IN_FLIGHT_RUN_STATUSES } from '@/app/teammate/teammateRunStatuses';
import type { Tx } from '@/storage/inTx';

/** Cancel active runs on the given threads inside the transaction; returns the daemon stops to send after commit. */
export async function cancelChannelRunsTx(tx: Tx, threadIds: string[]) {
    const calls: { machineId: string; runId: string; dispatchToken: string }[] = [];
    const runs = await tx.teammateRun.findMany({ where: { threadId: { in: threadIds }, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } }, include: { teammate: true } });
    for (const run of runs) {
        const cancelled = await teammateRunTerminateTx(tx, run.id, 'cancelled', 'cancelled_by_user', new Date());
        if (cancelled?.status === 'cancelled' && TEAMMATE_IN_FLIGHT_RUN_STATUSES.includes(run.status)) calls.push({ machineId: run.teammate.machineId, runId: run.id, dispatchToken: run.dispatchToken });
    }
    return calls;
}

/** Best-effort daemon stops for runs that were dispatching or running. */
export async function cancelChannelRunsPostCommit(accountId: string, calls: { machineId: string; runId: string; dispatchToken: string }[]) {
    for (const item of calls) try { await invokeUserRpc(accountId, `${item.machineId}:${TEAMMATE_RPC_RUN_CANCEL}`, { runId: item.runId, dispatchToken: item.dispatchToken, reason: 'cancelled_by_user' }, TEAMMATE_RPC_TIMEOUT_MS); } catch { /* best effort */ }
}

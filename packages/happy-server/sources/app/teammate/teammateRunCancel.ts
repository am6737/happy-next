import { inTx } from '@/storage/inTx';
import { TEAMMATE_RPC_RUN_CANCEL } from 'happy-wire';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { TEAMMATE_RPC_TIMEOUT_MS } from './teammateTaskTerminate';
import { TeammateError } from './teammateError';
import { teammateRunTerminateTx } from './teammateRunFinish';

/** Commit user cancellation first, then best-effort stop the daemon; terminal repeats do nothing. */
export async function teammateRunCancel(accountId: string, runId: string) {
    const result = await inTx(async (tx) => {
        const row = await tx.teammateRun.findFirst({ where: { id: runId, teammate: { accountId } }, include: { teammate: true, thread: true } });
        if (!row) throw new TeammateError('not_found');
        const run = await teammateRunTerminateTx(tx, runId, 'cancelled', 'cancelled_by_user', new Date());
        const cancel = (row.status === 'dispatching' || row.status === 'running') && run?.status === 'cancelled';
        return { run: run!, cancel, machineId: row.teammate.machineId, dispatchToken: row.dispatchToken };
    });
    if (result.cancel) {
        try { await invokeUserRpc(accountId, `${result.machineId}:${TEAMMATE_RPC_RUN_CANCEL}`, { runId, dispatchToken: result.dispatchToken, reason: 'cancelled_by_user' }, TEAMMATE_RPC_TIMEOUT_MS); } catch { /* best effort */ }
    }
    return result.run;
}

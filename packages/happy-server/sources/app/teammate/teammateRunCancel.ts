import { inTx } from '@/storage/inTx';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
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
        try { await invokeUserRpc(accountId, `${result.machineId}:teammate-run-cancel`, { runId, dispatchToken: result.dispatchToken, reason: 'cancelled_by_user' }, 30_000); } catch { /* best effort */ }
    }
    return result.run;
}

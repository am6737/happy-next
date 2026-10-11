import { afterTx, type Tx } from '@/storage/inTx';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { TEAMMATE_RPC_RUN_CANCEL, TEAMMATE_RPC_TASK_STOP, TeammateTaskStopPayloadSchema, type TeammateRunCancelPayload, type TeammateTaskStopPayload } from 'happy-wire';
import type { TeammateRun, TeammateTask, Teammate } from '@prisma/client';
import { teammateRunTerminateTx } from './teammateRunFinish';
import { TEAMMATE_ACTIVE_RUN_STATUSES, TEAMMATE_IN_FLIGHT_RUN_STATUSES } from './teammateRunStatuses';

type Task = TeammateTask & { teammate: Teammate };

export const TEAMMATE_RPC_TIMEOUT_MS = 30_000;

/** After commit, best-effort stop all daemon workers; the wire payload and timeout are shared. */
export function teammateTaskStopRpc(tx: Tx, task: Task, reason: TeammateTaskStopPayload['reason']) {
    const payload = TeammateTaskStopPayloadSchema.parse({ teammateId: task.teammateId, taskId: task.id, reason });
    afterTx(tx, () => { void invokeUserRpc(task.accountId, `${task.teammate.machineId}:${TEAMMATE_RPC_TASK_STOP}`, payload, TEAMMATE_RPC_TIMEOUT_MS).catch(() => {}); });
}

/** After commit, best-effort tell the daemon to stop one in-flight run. */
export function teammateRunCancelRpc(tx: Tx, teammate: Pick<Teammate, 'accountId' | 'machineId'>, run: Pick<TeammateRun, 'id' | 'dispatchToken'>, reason: TeammateRunCancelPayload['reason']) {
    afterTx(tx, () => { void invokeUserRpc(teammate.accountId, `${teammate.machineId}:${TEAMMATE_RPC_RUN_CANCEL}`, { runId: run.id, dispatchToken: run.dispatchToken, reason }, TEAMMATE_RPC_TIMEOUT_MS).catch(() => {}); });
}

/** Cancel every pending task-thread run atomically, then stop in-flight controllers after commit. */
export async function teammateTaskTerminate(tx: Tx, task: Task) {
    const runs = await tx.teammateRun.findMany({ where: { thread: { taskId: task.id }, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } } });
    for (const row of runs) {
        const run = await teammateRunTerminateTx(tx, row.id, 'cancelled', 'cancelled_by_user', new Date());
        if (run?.status === 'cancelled' && TEAMMATE_IN_FLIGHT_RUN_STATUSES.includes(row.status)) {
            teammateRunCancelRpc(tx, task.teammate, row, 'cancelled_by_user');
        }
    }
}

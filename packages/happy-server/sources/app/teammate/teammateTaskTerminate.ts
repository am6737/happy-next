import { afterTx, type Tx } from '@/storage/inTx';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { TEAMMATE_RPC_TASK_STOP, TeammateTaskStopPayloadSchema, type TeammateTaskStopPayload } from 'happy-wire';
import type { TeammateTask, Teammate } from '@prisma/client';
import { TEAMMATE_ACTIVE_RUN_STATUSES, teammateRunTerminateTx } from './teammateRunFinish';

type Task = TeammateTask & { teammate: Teammate };

/** After commit, best-effort stop all daemon workers; the wire payload and timeout are shared. */
export function teammateTaskStopRpc(tx: Tx, task: Task, reason: TeammateTaskStopPayload['reason']) {
    const payload = TeammateTaskStopPayloadSchema.parse({ teammateId: task.teammateId, taskId: task.id, reason });
    afterTx(tx, () => { void invokeUserRpc(task.accountId, `${task.teammate.machineId}:${TEAMMATE_RPC_TASK_STOP}`, payload, 30_000).catch(() => {}); });
}

/** Cancel every pending task-thread run atomically, then stop in-flight controllers after commit. */
export async function teammateTaskTerminate(tx: Tx, task: Task) {
    const runs = await tx.teammateRun.findMany({ where: { thread: { taskId: task.id }, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } } });
    for (const row of runs) {
        const run = await teammateRunTerminateTx(tx, row.id, 'cancelled', 'cancelled_by_user', new Date());
        if (run?.status === 'cancelled' && ['dispatching', 'running'].includes(row.status)) {
            afterTx(tx, () => { void invokeUserRpc(task.accountId, `${task.teammate.machineId}:teammate-run-cancel`, { runId: row.id, dispatchToken: row.dispatchToken, reason: 'cancelled_by_user' }, 30_000).catch(() => {}); });
        }
    }
}

import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskTerminate, teammateTaskStopRpc } from './teammateTaskTerminate';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';

/** Commit owner cancel and all run cancellations together before stopping daemon execution. */
export async function teammateTaskCancel(accountId: string, taskId: string) {
    return inTx(async tx => {
        const task = await tx.teammateTask.findFirst({ where: { id: taskId, accountId }, include: { teammate: true } });
        if (!task) throw new TeammateError('not_found');
        if (task.status === 'cancelled') return toTeammateTaskDto(task);
        const row = await tx.teammateTask.update({ where: { id: taskId }, data: { status: 'cancelled' } });
        await teammateTaskHandoffNotify(tx, task, row, 'owner');
        await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(row));
        await teammateTaskTerminate(tx, task);
        teammateTaskStopRpc(tx, task, 'cancelled');
        return toTeammateTaskDto(row);
    });
}

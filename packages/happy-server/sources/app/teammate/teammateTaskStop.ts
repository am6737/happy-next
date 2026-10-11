import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskTerminate, teammateTaskStopRpc } from './teammateTaskTerminate';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';

/** Commit owner stop and all run cancellations together before stopping daemon execution. */
export async function teammateTaskStop(accountId: string, taskId: string) {
    return inTx(async tx => {
        const task = await tx.teammateTask.findFirst({ where: { id: taskId, accountId }, include: { teammate: true } });
        if (!task) throw new TeammateError('not_found');
        if (['paused', 'cancelled'].includes(task.status)) return toTeammateTaskDto(task);
        if (task.status === 'done' && task.resourceId) {
            const open = await tx.teammateTask.findFirst({ where: { accountId, source: task.source, resourceId: task.resourceId, id: { not: task.id }, status: { notIn: ['done', 'cancelled'] } } });
            if (open) throw new TeammateError('already_delegated');
        }
        const row = await tx.teammateTask.update({ where: { id: taskId }, data: { status: 'paused' } });
        await teammateTaskHandoffNotify(tx, task, row, 'owner');
        await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(row));
        await teammateTaskTerminate(tx, task);
        teammateTaskStopRpc(tx, task, 'paused');
        return toTeammateTaskDto(row);
    });
}

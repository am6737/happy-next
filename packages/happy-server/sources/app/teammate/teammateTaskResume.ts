import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskWake } from './teammateTaskWake';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';

/** Resume only paused tasks atomically; this owner-requested wake bypasses the run limit once. */
export async function teammateTaskResume(accountId: string, taskId: string) {
    return inTx(async tx => {
        const task = await tx.teammateTask.findFirst({ where: { id: taskId, accountId } });
        if (!task) throw new TeammateError('not_found');
        if (task.status !== 'paused') return toTeammateTaskDto(task);
        const row = await tx.teammateTask.update({ where: { id: taskId }, data: { status: 'in_progress' } });
        await teammateTaskHandoffNotify(tx, task, row, 'owner');
        await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(row));
        await teammateTaskWake(taskId, { type: 'manual', at: Date.now(), data: { taskId, note: 'Task resumed by owner after a pause; a stop by the owner also ended its workers. Check work_session_list / work_session_read, then continue (use continueFrom for unfinished workers).' } }, { tx, bypassRunCap: true });
        return toTeammateTaskDto(row);
    });
}

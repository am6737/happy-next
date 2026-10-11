import { inTx, type Tx } from '@/storage/inTx';
import { TEAMMATE_TASK_ACTIVE_STATUSES, type TeammateRunEvent, type TeammateRunTrigger } from 'happy-wire';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskStopRpc, teammateTaskTerminate } from './teammateTaskTerminate';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';

export const TEAMMATE_TASK_MAX_RUNS = 60;

/** Single transactional wake path: drop inactive tasks, coalesce events and pause runaway execution. */
export async function teammateTaskWake(taskId: string, event: TeammateRunEvent, options: { tx?: Tx; bypassRunCap?: boolean; trigger?: TeammateRunTrigger } = {}): Promise<void> {
    const wake = async (tx: Tx) => {
        const task = await tx.teammateTask.findUnique({ where: { id: taskId }, include: { teammate: true } });
        if (!task || !(TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status) || task.teammate.status === 'archived') return;
        if (!options.bypassRunCap && await tx.teammateRun.count({ where: { taskId } }) >= TEAMMATE_TASK_MAX_RUNS) {
            const row = await tx.teammateTask.update({ where: { id: taskId }, data: { status: 'paused', summary: 'Run limit reached' } });
            await teammateTaskHandoffNotify(tx, task, row, 'system');
            await teammateTaskUpdated(tx, task.accountId, toTeammateTaskDto(row));
            await teammateTaskTerminate(tx, task);
            teammateTaskStopRpc(tx, task, 'run_limit');
            return;
        }
        const thread = await teammateThreadEnsure(task.teammateId, 'task', { taskId }, tx);
        await teammateRunEnqueue({ teammateId: task.teammateId, threadId: thread.id, trigger: options.trigger ?? event.type, event }, tx);
    };
    return options.tx ? wake(options.tx) : inTx(wake);
}

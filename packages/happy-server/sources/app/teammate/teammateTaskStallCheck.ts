import type { TeammateRun } from '@prisma/client';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { isSessionBusy } from '@/app/presence/sessionTurnRuntime';
import { teammateTaskWake } from './teammateTaskWake';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { toTeammateTaskDto } from './teammateQueries';
import { SILENT_FAILURE_REASONS } from './teammateRunStatuses';

const TEAMMATE_TASK_STALL_MS = 5 * 60_000;
const TEAMMATE_TASK_FAILED_STALL_MS = 10 * 60_000;
const TEAMMATE_TASK_STALL_MAX_WAKES = 2;

const isStallWake = (run: TeammateRun) => run.trigger === 'heartbeat'
    && ((run.eventPayload as { events?: { data?: { signal?: unknown } }[] }).events ?? []).every(event => event.data?.signal === 'stalled');

/**
 * Safety net for tasks nobody will wake again: the controller's last run ended (or failed) a while ago,
 * the task is still todo/in_progress, nothing is queued and no worker of the task is busy. This happens when
 * a controller ends its turn without a worker (or a worker crashed, or a wake was lost). The controller is
 * reminded up to TEAMMATE_TASK_STALL_MAX_WAKES times in a row; after that the task is paused so the creator
 * or owner is told instead of waking forever. Tasks waiting on the owner are awaiting_input and never match.
 */
export async function teammateTaskStallCheck(teammateId: string, now = new Date()): Promise<void> {
    const tasks = await db.teammateTask.findMany({ where: { teammateId, status: { in: ['todo', 'in_progress'] } }, include: { threads: true } });
    for (const task of tasks) {
        const thread = task.threads.find(item => item.kind === 'task');
        if (!thread) continue;
        const runs = await db.teammateRun.findMany({ where: { threadId: thread.id }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }], take: TEAMMATE_TASK_STALL_MAX_WAKES + 1 });
        const latest = runs[0];
        if (!latest?.finishedAt || !['completed', 'failed'].includes(latest.status)) continue;
        if (SILENT_FAILURE_REASONS.includes(latest.failureReason ?? '')) continue;
        if (latest.finishedAt.getTime() > now.getTime() - (latest.status === 'failed' ? TEAMMATE_TASK_FAILED_STALL_MS : TEAMMATE_TASK_STALL_MS)) continue;
        const workers = await db.teammateSession.findMany({ where: { taskId: task.id, role: 'worker' }, select: { sessionId: true } });
        if (workers.some(worker => isSessionBusy(worker.sessionId))) continue;

        const reminders = runs.findIndex(run => !isStallWake(run));
        if ((reminders === -1 ? runs.length : reminders) < TEAMMATE_TASK_STALL_MAX_WAKES) {
            await teammateTaskWake(task.id, { type: 'heartbeat', at: now.getTime(), data: { signal: 'stalled', failureReason: latest.failureReason, status: task.status } });
            continue;
        }
        await inTx(async tx => {
            const before = await tx.teammateTask.findUnique({ where: { id: task.id } });
            if (!before || !['todo', 'in_progress'].includes(before.status)) return;
            const row = await tx.teammateTask.update({ where: { id: task.id }, data: { status: 'paused', summary: 'Stalled: no progress after repeated reminders' } });
            await teammateTaskHandoffNotify(tx, before, row, 'system');
            await teammateTaskUpdated(tx, row.accountId, toTeammateTaskDto(row));
        });
    }
}

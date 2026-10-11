import { afterTx, inTx } from '@/storage/inTx';
import type { TeammateRunStartedRequest } from 'happy-wire';
import { teammateRunAuthenticate } from './teammateRunAuthorize';
import { teammateRunUpdated } from './teammateRunUpdated';
import { toTeammateRunDto, toTeammateTaskDto } from './teammateQueries';
import { teammateSessionCacheInvalidate } from './teammateSessionCache';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { TeammateError } from './teammateError';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';

/** Register the account-owned controller and mirror its thread session atomically; repeats preserve startedAt. */
export async function teammateRunStart(runId: string, req: TeammateRunStartedRequest, accountId: string): Promise<void> {
    await inTx(async (tx) => {
        const row = await teammateRunAuthenticate(tx, runId, accountId, req.dispatchToken);
        if (row.status !== 'dispatching') return;
        const session = await tx.session.findFirst({ where: { id: req.sessionId, accountId }, select: { id: true } });
        if (!session) throw new TeammateError('not_found');
        const now = new Date();
        const changed = await tx.teammateRun.updateMany({ where: { id: runId, status: 'dispatching', dispatchToken: req.dispatchToken }, data: { status: 'running', startedAt: now, sessionId: req.sessionId } });
        if (!changed.count) return;
        const registration = { teammateId: row.teammateId, threadId: row.threadId, role: 'controller', taskId: row.thread.taskId };
        await tx.teammateSession.upsert({ where: { sessionId: req.sessionId }, create: { sessionId: req.sessionId, ...registration }, update: registration });
        await tx.teammateThread.update({ where: { id: row.threadId }, data: { currentSessionId: req.sessionId, lastActiveAt: now } });
        if (row.thread.kind === 'task' && row.thread.taskId) {
            const task = await tx.teammateTask.findUnique({ where: { id: row.thread.taskId } });
            if (task?.status === 'todo') {
                const updated = await tx.teammateTask.update({ where: { id: task.id }, data: { status: 'in_progress' } });
                await teammateTaskHandoffNotify(tx, task, updated, 'system');
                await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(updated));
            }
        }
        afterTx(tx, () => teammateSessionCacheInvalidate(req.sessionId));
        await teammateRunUpdated(tx, accountId, toTeammateRunDto({ ...row, status: 'running', startedAt: now, sessionId: req.sessionId }));
    });
}

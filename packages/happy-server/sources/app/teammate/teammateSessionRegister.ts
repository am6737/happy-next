import { afterTx, inTx } from '@/storage/inTx';
import { TeammateSessionRegisterRequestSchema, type TeammateSessionRegisterRequest } from 'happy-wire';
import { teammateRunAuthorize } from './teammateRunAuthorize';
import { teammateSessionCacheInvalidate } from './teammateSessionCache';
import { TeammateError } from './teammateError';

/** Register an account-owned worker on a live or recent task run and invalidate cached misses after commit. */
export async function teammateSessionRegister(accountId: string, input: TeammateSessionRegisterRequest): Promise<void> {
    const req = TeammateSessionRegisterRequestSchema.parse(input);
    await inTx(async tx => {
        const run = await teammateRunAuthorize(accountId, req.runId, req.dispatchToken, tx);
        if (run.thread.kind !== 'task' || !run.thread.taskId || !['dispatching', 'running', 'completed', 'failed', 'cancelled'].includes(run.status)) throw new TeammateError('invalid_request');
        if (!await tx.session.findFirst({ where: { id: req.sessionId, accountId } })) throw new TeammateError('not_found');
        const registration = { teammateId: run.teammateId, threadId: run.threadId, taskId: run.thread.taskId, role: 'worker' };
        const existing = await tx.teammateSession.findUnique({ where: { sessionId: req.sessionId } });
        if (existing && (existing.role !== 'worker' || existing.taskId !== registration.taskId || existing.threadId !== registration.threadId || existing.teammateId !== registration.teammateId)) throw new TeammateError('invalid_request');
        await tx.teammateSession.upsert({ where: { sessionId: req.sessionId }, create: { sessionId: req.sessionId, ...registration }, update: registration });
        afterTx(tx, () => teammateSessionCacheInvalidate(req.sessionId));
    });
}

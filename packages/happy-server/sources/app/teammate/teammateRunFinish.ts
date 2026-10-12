import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { inTx, type Tx } from '@/storage/inTx';
import type { TeammateRunFailureReason, TeammateRunFinishedRequest } from 'happy-wire';
import { TeammateError } from './teammateError';
import { teammateRunAuthenticate } from './teammateRunAuthorize';
import { toTeammateRunDto } from './teammateQueries';
import { teammateRunUpdated } from './teammateRunUpdated';
import { TEAMMATE_ACTIVE_RUN_STATUSES, SILENT_FAILURE_REASONS } from './teammateRunStatuses';
import { channelSystemMessage } from '@/app/channel/channelSystemMessage';

const RETRY_REASONS = ['spawn_failed', 'dispatch_timeout', 'runtime_recovery', 'context_overflow'];

/**
 * Conditional terminal transition and its one retry share a transaction, preventing duplicate retries.
 * A failure that will not be retried automatically is announced in the thread's channel (keyed by run, so
 * it is posted once) so the owner sees why the Agent went quiet and can retry it from the chat.
 */
export async function teammateRunTerminateTx(tx: Tx, runId: string, status: 'failed' | 'cancelled' | 'completed', failureReason: TeammateRunFailureReason | null, now: Date, expected: Prisma.TeammateRunWhereInput = {}, options: { allowCompleted?: boolean } = {}) {
    const row = await tx.teammateRun.findUnique({ where: { id: runId }, include: { teammate: true, thread: true } });
    const acceptable = TEAMMATE_ACTIVE_RUN_STATUSES.includes(row?.status ?? '') || (options.allowCompleted === true && row?.status === 'completed');
    if (!row || !acceptable) return row ? toTeammateRunDto(row) : null;
    const changed = await tx.teammateRun.updateMany({ where: { AND: [{ id: runId, status: row.status, dispatchToken: row.dispatchToken }, expected] }, data: { status, failureReason, finishedAt: now } });
    if (!changed.count) return null;
    const run = toTeammateRunDto({ ...row, status, failureReason, finishedAt: now });
    await teammateRunUpdated(tx, row.teammate.accountId, run);
    const retrying = status === 'failed' && !!failureReason && RETRY_REASONS.includes(failureReason) && row.attempt < 2;
    if (status === 'failed' && !retrying && row.thread.channelId && !SILENT_FAILURE_REASONS.includes(failureReason ?? '')) {
        await channelSystemMessage(row.thread.channelId, 'run_failed', { runId, teammateId: row.teammateId, name: row.teammate.name, reason: failureReason ?? 'unknown' }, tx, `system:run_failed:${runId}`);
    }
    if (retrying) {
        const retry = await tx.teammateRun.create({ data: { teammateId: row.teammateId, threadId: row.threadId, taskId: row.taskId, trigger: 'retry', status: 'queued', attempt: row.attempt + 1, eventPayload: row.eventPayload as Prisma.InputJsonValue, dispatchToken: randomUUID(), queuedAt: now }, include: { thread: true } });
        await teammateRunUpdated(tx, row.teammate.accountId, toTeammateRunDto(retry));
    }
    return run;
}

/** Daemon failures/cancellations are token-protected, terminal-idempotent, and retry once. */
export async function teammateRunFinish(runId: string, req: TeammateRunFinishedRequest, accountId: string): Promise<void> {
    await inTx(async (tx) => {
        await teammateRunAuthenticate(tx, runId, accountId, req.dispatchToken);
        await teammateRunTerminateTx(tx, runId, req.status, req.failureReason ?? (req.status === 'failed' ? 'unknown' : null), new Date());
    });
}

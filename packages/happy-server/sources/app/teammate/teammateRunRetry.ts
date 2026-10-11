import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TeammateRun } from 'happy-wire';
import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateRunDto } from './teammateQueries';
import { teammateRunUpdated } from './teammateRunUpdated';
import { TEAMMATE_ACTIVE_RUN_STATUSES } from './teammateRunFinish';

/**
 * Owner-requested retry of a failed run: its events are queued again on the same thread as a fresh attempt.
 * Idempotent: once a retry of this failure is queued or working, repeated calls return that run, and a run
 * already queued on the thread absorbs the events instead of a second run being created.
 */
export async function teammateRunRetry(accountId: string, runId: string): Promise<TeammateRun> {
    return inTx(async (tx) => {
        const failed = await tx.teammateRun.findFirst({ where: { id: runId, teammate: { accountId } }, include: { teammate: true } });
        if (!failed) throw new TeammateError('not_found');
        if (failed.teammate.status === 'archived') throw new TeammateError('archived');
        if (failed.status !== 'failed') throw new TeammateError('invalid_request');
        const eventsOf = (row: { eventPayload: unknown }) => (row.eventPayload as { events?: Prisma.InputJsonValue[] } | null)?.events ?? [];
        const events = eventsOf(failed);
        const pending = await tx.teammateRun.findMany({
            where: { threadId: failed.threadId, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } },
            orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }], include: { thread: true },
        });
        const keys = (row: { eventPayload: unknown }) => new Set(eventsOf(row).map(event => JSON.stringify(event)));
        const covering = pending.find(row => { const have = keys(row); return events.every(event => have.has(JSON.stringify(event))); });
        if (covering) return toTeammateRunDto(covering);
        const queued = await tx.teammateRun.findFirst({ where: { threadId: failed.threadId, status: 'queued' }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }] });
        const row = queued
            ? await tx.teammateRun.update({ where: { id: queued.id }, data: { eventPayload: { events: [...eventsOf(queued), ...events] } as Prisma.InputJsonValue }, include: { thread: true } })
            : await tx.teammateRun.create({
                data: { teammateId: failed.teammateId, threadId: failed.threadId, taskId: failed.taskId, trigger: 'retry', status: 'queued', attempt: 1, dispatchToken: randomUUID(), eventPayload: { events } as Prisma.InputJsonValue },
                include: { thread: true },
            });
        const run = toTeammateRunDto(row);
        await teammateRunUpdated(tx, failed.teammate.accountId, run);
        return run;
    });
}

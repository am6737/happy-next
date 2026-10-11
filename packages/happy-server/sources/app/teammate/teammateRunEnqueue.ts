import { randomUUID } from 'node:crypto';
import { inTx, type Tx } from '@/storage/inTx';
import { TeammateRunEventSchema, type TeammateRunEvent, type TeammateRunTrigger } from 'happy-wire';
import { Prisma } from '@prisma/client';
import { TeammateError } from './teammateError';
import { toTeammateRunDto } from './teammateQueries';
import { teammateRunUpdated } from './teammateRunUpdated';

/** Append to the queued run atomically, or queue a new attempt beside an active run. */
export async function teammateRunEnqueue(input: { teammateId: string; threadId: string; trigger: TeammateRunTrigger; event: TeammateRunEvent }, tx?: Tx) {
    const event = TeammateRunEventSchema.parse(input.event);
    const enqueue = async (tx: Tx) => {
        const teammate = await tx.teammate.findUnique({ where: { id: input.teammateId } });
        if (!teammate) throw new TeammateError('not_found');
        if (teammate.status === 'archived') throw new TeammateError('archived');
        const thread = await tx.teammateThread.findFirst({ where: { id: input.threadId, teammateId: input.teammateId } });
        if (!thread) throw new TeammateError('not_found');
        const queued = await tx.teammateRun.findFirst({ where: { threadId: thread.id, status: 'queued' }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }] });
        const previous = queued?.eventPayload as { events?: unknown[] } | undefined;
        const eventPayload = { events: [...(previous?.events ?? []), event] } as Prisma.InputJsonValue;
        const row = queued
            ? await tx.teammateRun.update({ where: { id: queued.id }, data: { eventPayload }, include: { thread: true } })
            : await tx.teammateRun.create({ data: { teammateId: teammate.id, threadId: thread.id, taskId: thread.taskId, trigger: input.trigger, status: 'queued', attempt: 1, dispatchToken: randomUUID(), eventPayload }, include: { thread: true } });
        const run = toTeammateRunDto(row);
        await teammateRunUpdated(tx, teammate.accountId, run);
        return run;
    };
    return tx ? enqueue(tx) : inTx(enqueue);
}

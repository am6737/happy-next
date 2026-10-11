import type { TeammateTask } from '@prisma/client';
import type { Tx } from '@/storage/inTx';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { TeammateError } from './teammateError';

const HANDOFF_STATUSES = new Set(['in_review', 'awaiting_input', 'done', 'cancelled', 'paused']);

/**
 * Wake the task creator after an assignee hands work back. The original creator
 * thread is preferred while it remains a DM/group thread owned by that creator;
 * otherwise the creator's DM is ensured from its channel membership. Missing
 * or archived creators and missing threads are intentionally ignored so a task
 * status update remains safe and idempotent; database errors propagate so the
 * surrounding transaction is retried instead of failing on its next statement.
 */
export async function teammateTaskHandoffNotify(
    tx: Tx,
    before: TeammateTask,
    after: TeammateTask,
    by: 'agent' | 'owner' | 'system',
    options: { suppress?: boolean } = {},
): Promise<void> {
    if (options.suppress) return;
    if (before.status === after.status || !HANDOFF_STATUSES.has(after.status)) return;
    const creatorId = after.createdByTeammateId;
    if (!creatorId || creatorId === after.teammateId) return;

    const creator = await tx.teammate.findFirst({
        where: { id: creatorId, accountId: after.accountId },
        select: { id: true, status: true },
    });
    if (!creator || creator.status === 'archived') return;

    let thread = after.createdByThreadId
        ? await tx.teammateThread.findFirst({
            where: { id: after.createdByThreadId, teammateId: creator.id, kind: { in: ['dm', 'group'] } },
        })
        : null;
    if (!thread) {
        const dm = await tx.channel.findFirst({
            where: {
                accountId: after.accountId,
                kind: 'dm',
                members: { some: { memberType: 'teammate', teammateId: creator.id } },
            },
            select: { id: true },
        });
        if (!dm) return;
        thread = await teammateThreadEnsure(creator.id, 'dm', { channelId: dm.id }, tx);
    }

    const assignee = await tx.teammate.findUnique({ where: { id: after.teammateId }, select: { handle: true } });
    try {
        await teammateRunEnqueue({
            teammateId: creator.id,
            threadId: thread.id,
            trigger: 'task-update',
            event: {
                type: 'task-update',
                at: Date.now(),
                data: {
                    taskId: after.id,
                    title: after.title,
                    resourceId: after.resourceId,
                    url: after.url,
                    from: before.status,
                    to: after.status,
                    summary: after.summary,
                    prUrl: after.prUrl,
                    assigneeId: after.teammateId,
                    assigneeHandle: assignee?.handle ?? null,
                    by,
                },
            },
        }, tx);
    } catch (error) {
        // A concurrent delete/archive can invalidate the target between the checks above. Database errors must
        // propagate: they abort the transaction, and inTx can only retry serialization conflicts it sees.
        if (!(error instanceof TeammateError)) throw error;
    }
}

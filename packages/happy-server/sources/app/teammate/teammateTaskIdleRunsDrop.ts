import type { Tx } from '@/storage/inTx';
import { teammateRunTerminateTx } from './teammateRunFinish';

/**
 * When the controller hands a task off (in_review or done), it has already read its workers' results,
 * so queued runs that only carry work-session-idle events would wake it for nothing. They are completed
 * without dispatch; queued runs with any other event (review feedback, PR updates) are kept.
 */
export async function teammateTaskIdleRunsDrop(tx: Tx, taskId: string) {
    const queued = await tx.teammateRun.findMany({ where: { taskId, status: 'queued' } });
    for (const row of queued) {
        const events = (row.eventPayload as { events?: { type?: string }[] }).events ?? [];
        if (events.every(event => event.type === 'work-session-idle')) {
            await teammateRunTerminateTx(tx, row.id, 'completed', null, new Date(), { status: 'queued' });
        }
    }
}

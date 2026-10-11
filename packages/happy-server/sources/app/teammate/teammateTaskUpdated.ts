import { afterTx, type Tx } from '@/storage/inTx';
import { buildTeammateTaskUpdatedUpdate, eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import type { TeammateTask } from 'happy-wire';

/** Allocate the persistent account sequence in the write transaction and emit after commit. */
export async function teammateTaskUpdated(tx: Tx, accountId: string, task: TeammateTask): Promise<void> {
    const { seq } = await tx.account.update({ where: { id: accountId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    const payload = buildTeammateTaskUpdatedUpdate(task, seq, randomKeyNaked(12));
    afterTx(tx, () => { eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } }); });
}

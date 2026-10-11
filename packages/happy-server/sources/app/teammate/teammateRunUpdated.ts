import { afterTx, type Tx } from '@/storage/inTx';
import { buildTeammateRunUpdatedUpdate, eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import type { TeammateRun } from 'happy-wire';

/** Increment the account sequence and emit the run snapshot only after commit. */
export async function teammateRunUpdated(tx: Tx, accountId: string, run: TeammateRun): Promise<void> {
    const { seq } = await tx.account.update({ where: { id: accountId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    const payload = buildTeammateRunUpdatedUpdate(run, seq, randomKeyNaked(12));
    afterTx(tx, () => { eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } }); });
}

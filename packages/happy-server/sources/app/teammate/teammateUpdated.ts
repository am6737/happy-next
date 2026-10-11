import { afterTx, type Tx } from '@/storage/inTx';
import { buildTeammateUpdatedUpdate, eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import type { Teammate } from 'happy-wire';

/** Allocate the account sequence atomically and notify clients only after commit. */
export async function teammateUpdated(tx: Tx, accountId: string, teammate: Teammate): Promise<void> {
    const { seq } = await tx.account.update({
        where: { id: accountId },
        data: { seq: { increment: 1 } },
        select: { seq: true },
    });
    const payload = buildTeammateUpdatedUpdate(teammate, seq, randomKeyNaked(12));
    afterTx(tx, () => {
        eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } });
    });
}

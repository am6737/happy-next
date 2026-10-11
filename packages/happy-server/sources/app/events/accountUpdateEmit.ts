import { afterTx, type Tx } from '@/storage/inTx';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { eventRouter, type UpdatePayload } from './eventRouter';

/** Allocate the account sequence in the write transaction and send the update to the account's clients only after commit. */
export async function accountUpdateEmit(tx: Tx, accountId: string, body: UpdatePayload['body']): Promise<void> {
    const { seq } = await tx.account.update({ where: { id: accountId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    const payload: UpdatePayload = { id: randomKeyNaked(12), seq, body, createdAt: Date.now() };
    afterTx(tx, () => { eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } }); });
}

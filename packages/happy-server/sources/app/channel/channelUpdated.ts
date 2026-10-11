import { afterTx, type Tx } from '@/storage/inTx';
import { eventRouter, buildChannelUpdatedUpdate, buildNewChannelMessageUpdate } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import type { Channel, ChannelMessage } from 'happy-wire';

/** Allocate an account sequence in the write transaction and emit only after commit. */
export async function channelUpdated(tx: Tx, accountId: string, channel: Channel) {
    const { seq } = await tx.account.update({ where: { id: accountId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    const payload = buildChannelUpdatedUpdate(channel, seq, randomKeyNaked(12));
    afterTx(tx, () => { eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } }); });
}

/** Publish an inserted message with a persistent account sequence after commit. */
export async function channelMessageUpdated(tx: Tx, accountId: string, message: ChannelMessage) {
    const { seq } = await tx.account.update({ where: { id: accountId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    const payload = buildNewChannelMessageUpdate(message, seq, randomKeyNaked(12));
    afterTx(tx, () => { eventRouter.emitUpdate({ userId: accountId, payload, recipientFilter: { type: 'user-scoped-only' } }); });
}

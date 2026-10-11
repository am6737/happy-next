import type { Tx } from '@/storage/inTx';
import { accountUpdateEmit } from '@/app/events/accountUpdateEmit';
import type { Channel, ChannelMessage } from 'happy-wire';

/** Publish channel metadata. */
export async function channelUpdated(tx: Tx, accountId: string, channel: Channel) {
    await accountUpdateEmit(tx, accountId, { t: 'channel-updated', channel });
}

/** Publish an inserted message. */
export async function channelMessageUpdated(tx: Tx, accountId: string, message: ChannelMessage) {
    await accountUpdateEmit(tx, accountId, { t: 'new-channel-message', message });
}

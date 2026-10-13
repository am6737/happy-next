import { inTx } from '@/storage/inTx';
import { cancelChannelRunsPostCommit, cancelChannelRunsTx } from './channelRunsCancel';
import { accountUpdateEmit } from '@/app/events/accountUpdateEmit';
import { ChannelError } from './channelError';

/** Delete a group after cancelling its active runs. Threads are retained and channelId is set null by Prisma. */
export async function channelDelete(accountId: string, channelId: string) {
    const rpc = await inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId } });
        if (!channel) throw new ChannelError('not_found');
        if (channel.kind !== 'group') throw new ChannelError('not_group');
        const threads = await tx.teammateThread.findMany({ where: { channelId } });
        const calls = await cancelChannelRunsTx(tx, threads.map(thread => thread.id));
        await tx.channel.delete({ where: { id: channelId } });
        await accountUpdateEmit(tx, accountId, { t: 'channel-deleted', channelId });
        return calls;
    });
    await cancelChannelRunsPostCommit(accountId, rpc);
    return { ok: true as const };
}

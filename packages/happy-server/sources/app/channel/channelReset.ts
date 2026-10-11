import { inTx } from '@/storage/inTx';
import { ChannelError } from './channelError';
import { channelSystemMessage } from './channelSystemMessage';

/** Reset all channel contexts and post a notice; consecutive retries reuse the last reset. */
export async function channelReset(accountId: string, channelId: string) {
    await inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId } });
        if (!channel) throw new ChannelError('not_found');
        const latest = await tx.channelMessage.findFirst({ where: { channelId }, orderBy: { seq: 'desc' } });
        const content = latest?.content as { t?: string; code?: string } | undefined;
        if (content?.t === 'system' && content.code === 'context_reset') return;
        const resetAt = new Date();
        await tx.teammateThread.updateMany({ where: { channelId, teammate: { accountId } }, data: { resetAt } });
        await channelSystemMessage(channelId, 'context_reset', { resetAt: resetAt.getTime() }, tx, `system:reset:${channel.seq}`);
    });
}

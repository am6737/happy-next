import { inTx } from '@/storage/inTx';
import { ChannelError } from './channelError';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/** Advance the caller's read cursor monotonically, bounded by the channel's current sequence. */
export async function channelMarkRead(accountId: string, channelId: string, seq: number) {
    return inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!channel) throw new ChannelError('not_found');
        const member = channel.members.find(m => m.memberType === 'user' && m.accountId === accountId);
        if (!member) throw new ChannelError('not_found');
        const lastReadSeq = Math.min(channel.seq, seq);
        if (lastReadSeq <= member.lastReadSeq) return;
        await tx.channelMember.update({ where: { id: member.id }, data: { lastReadSeq } });
        await channelUpdated(tx, accountId, toChannelDto({ ...channel, members: channel.members.map(m => m.id === member.id ? { ...m, lastReadSeq } : m) }));
    });
}

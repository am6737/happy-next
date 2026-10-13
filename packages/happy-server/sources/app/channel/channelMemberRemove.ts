import { inTx } from '@/storage/inTx';
import { cancelChannelRunsPostCommit, cancelChannelRunsTx } from './channelRunsCancel';
import { ChannelError } from './channelError';
import { channelSystemMessage } from './channelSystemMessage';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/** Remove a teammate, cancelling active runs in the group thread. */
export async function channelMemberRemove(accountId: string, channelId: string, teammateId: string) {
    const result = await inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!channel) throw new ChannelError('not_found');
        if (channel.kind !== 'group') throw new ChannelError('not_group');
        const member = channel.members.find(m => m.teammateId === teammateId);
        if (!member) throw new ChannelError('not_found');
        if (channel.members.filter(m => m.memberType === 'teammate').length <= 1) throw new ChannelError('last_member');
        const thread = await tx.teammateThread.findFirst({ where: { teammateId, channelId } });
        const rpc = thread ? await cancelChannelRunsTx(tx, [thread.id]) : [];
        await tx.channelMember.delete({ where: { id: member.id } });
        await channelSystemMessage(channelId, 'member_removed', { teammateIds: [teammateId] }, tx, `system:member_removed:${channel.seq}:${teammateId}`);
        const fresh = await tx.channel.findUniqueOrThrow({ where: { id: channelId }, include: { members: true } });
        const dto = toChannelDto(fresh);
        await channelUpdated(tx, accountId, dto);
        return { dto, rpc };
    });
    await cancelChannelRunsPostCommit(accountId, result.rpc);
    return result.dto;
}

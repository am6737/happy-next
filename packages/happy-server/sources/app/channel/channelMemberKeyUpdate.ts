import { inTx } from '@/storage/inTx';
import * as privacyKit from 'privacy-kit';
import { ChannelError } from './channelError';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/** Replace a teammate member's wrapped key without changing the shared channel key. */
export async function channelMemberKeyUpdate(accountId: string, channelId: string, teammateId: string, encryptedDataKey: string) {
    const key = privacyKit.decodeBase64(encryptedDataKey);
    return inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!channel) throw new ChannelError('not_found');
        const member = channel.members.find(m => m.memberType === 'teammate' && m.teammateId === teammateId);
        if (!member) throw new ChannelError('not_found');
        if (privacyKit.encodeBase64(member.encryptedDataKey) === privacyKit.encodeBase64(key)) return;
        await tx.channelMember.update({ where: { id: member.id }, data: { encryptedDataKey: key } });
        await channelUpdated(tx, accountId, toChannelDto({ ...channel, members: channel.members.map(m => m.id === member.id ? { ...m, encryptedDataKey: key } : m) }));
    });
}

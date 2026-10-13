import { inTx } from '@/storage/inTx';
import { ChannelMembersAddRequestSchema, type ChannelMembersAddRequest } from 'happy-wire';
import * as privacyKit from 'privacy-kit';
import { teammateThreadEnsure } from '@/app/teammate/teammateThreadEnsure';
import { ChannelError } from './channelError';
import { channelSystemMessage } from './channelSystemMessage';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/**
 * Add teammates to a group. Each new member gets its wrapped channel key and a group thread whose resetAt matches the
 * group's current context start, so it sees the recent messages but nothing before the last reset; a re-added
 * teammate also loses its old sessions. Retrying a request whose teammates are all members already returns the
 * channel unchanged, while a request that only partly overlaps the members is rejected.
 */
export async function channelMembersAdd(accountId: string, channelId: string, input: ChannelMembersAddRequest) {
    const req = ChannelMembersAddRequestSchema.parse(input);
    return inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!channel) throw new ChannelError('not_found');
        if (channel.kind !== 'group') throw new ChannelError('not_group');
        const ids = req.teammates.map(x => x.teammateId);
        if (new Set(ids).size !== ids.length) throw new ChannelError('invalid_request');
        const existing = ids.filter(id => channel.members.some(m => m.teammateId === id));
        if (existing.length === ids.length) return toChannelDto(channel);
        if (existing.length) throw new ChannelError('invalid_request');
        if (channel.members.filter(m => m.memberType === 'teammate').length + ids.length > 20) throw new ChannelError('full');
        for (const id of ids) {
            const teammate = await tx.teammate.findFirst({ where: { id, accountId } });
            if (!teammate) throw new ChannelError('not_found');
            if (teammate.status === 'archived') throw new ChannelError('archived');
        }
        // channelReset sets every thread to the same resetAt, so the maximum is the latest context start.
        const resetAt = (await tx.teammateThread.aggregate({ where: { channelId }, _max: { resetAt: true } }))._max.resetAt;
        for (const item of req.teammates) {
            await tx.channelMember.create({ data: { channelId, memberType: 'teammate', teammateId: item.teammateId, encryptedDataKey: privacyKit.decodeBase64(item.encryptedDataKey) } });
            const thread = await teammateThreadEnsure(item.teammateId, 'group', { channelId }, tx);
            await tx.teammateThread.update({ where: { id: thread.id }, data: { resetAt, providerSessionId: null, currentSessionId: null } });
        }
        await channelSystemMessage(channelId, 'member_added', { teammateIds: ids }, tx, `system:member_added:${channel.seq}:${ids.slice().sort().join(',')}`);
        const fresh = await tx.channel.findUniqueOrThrow({ where: { id: channelId }, include: { members: true } });
        const dto = toChannelDto(fresh);
        await channelUpdated(tx, accountId, dto);
        return dto;
    });
}

import { inTx } from '@/storage/inTx';
import { ChannelUpdateRequestSchema, type ChannelUpdateRequest } from 'happy-wire';
import { ChannelError } from './channelError';
import { channelSystemMessage } from './channelSystemMessage';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/** Rename a group channel and announce the change. */
export async function channelUpdate(accountId: string, channelId: string, input: ChannelUpdateRequest) {
    const req = ChannelUpdateRequestSchema.parse(input);
    return inTx(async tx => {
        const row = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!row) throw new ChannelError('not_found');
        if (row.kind !== 'group') throw new ChannelError('not_group');
        if (row.title === req.title) return toChannelDto(row);
        await tx.channel.update({ where: { id: channelId }, data: { title: req.title } });
        await channelSystemMessage(channelId, 'title_changed', { title: req.title }, tx, `system:title:${row.seq}`);
        const channel = toChannelDto(await tx.channel.findUniqueOrThrow({ where: { id: channelId }, include: { members: true } }));
        await channelUpdated(tx, accountId, channel);
        return channel;
    });
}

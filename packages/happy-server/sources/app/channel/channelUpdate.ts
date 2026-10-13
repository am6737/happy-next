import { inTx } from '@/storage/inTx';
import { ChannelUpdateRequestSchema, type ChannelUpdateRequest } from 'happy-wire';
import { ChannelError } from './channelError';
import { channelSystemMessage } from './channelSystemMessage';
import { channelUpdated } from './channelUpdated';
import { toChannelDto } from './channelQueries';

/** Rename a group channel or replace its encrypted brief, and announce each change. */
export async function channelUpdate(accountId: string, channelId: string, input: ChannelUpdateRequest) {
    const req = ChannelUpdateRequestSchema.parse(input);
    return inTx(async tx => {
        const row = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
        if (!row) throw new ChannelError('not_found');
        if (row.kind !== 'group') throw new ChannelError('not_group');
        const title = req.title !== undefined && req.title !== row.title ? req.title : undefined;
        const brief = req.brief !== undefined && req.brief !== row.brief ? req.brief : undefined;
        if (title === undefined && brief === undefined) return toChannelDto(row);
        await tx.channel.update({ where: { id: channelId }, data: { title, brief } });
        if (title !== undefined) await channelSystemMessage(channelId, 'title_changed', { title }, tx, `system:title:${row.seq}`);
        // The brief is ciphertext: the message only says that it changed (or was cleared).
        if (brief !== undefined) await channelSystemMessage(channelId, 'brief_changed', { cleared: brief === null }, tx, `system:brief:${row.seq}`);
        const channel = toChannelDto(await tx.channel.findUniqueOrThrow({ where: { id: channelId }, include: { members: true } }));
        await channelUpdated(tx, accountId, channel);
        return channel;
    });
}

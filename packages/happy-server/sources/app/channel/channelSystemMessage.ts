import { createHash } from 'node:crypto';
import { inTx, type Tx } from '@/storage/inTx';
import type { ChannelSystemCode } from 'happy-wire';
import { Prisma } from '@prisma/client';
import { ChannelError } from './channelError';
import { toChannelDto, toChannelMessageDto } from './channelQueries';
import { channelUpdated, channelMessageUpdated } from './channelUpdated';

/** Insert server-readable messages atomically; a localId makes each guard/reset operation retryable. */
export async function channelSystemMessage(channelId: string, code: ChannelSystemCode, data: Record<string, unknown>, tx?: Tx, localId?: string) {
    const messageLocalId = localId ?? `system:${code}:${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
    const insert = async (tx: Tx) => {
        {
            const existing = await tx.channelMessage.findUnique({ where: { channelId_localId: { channelId, localId: messageLocalId } } });
            if (existing) return toChannelMessageDto(existing);
        }
        const current = await tx.channel.findUnique({ where: { id: channelId } });
        if (!current) throw new ChannelError('not_found');
        const now = new Date();
        const channel = await tx.channel.update({ where: { id: channelId }, data: { seq: { increment: 1 }, lastMessageAt: now }, include: { members: true } });
        const row = await tx.channelMessage.create({ data: { channelId, seq: channel.seq, localId: messageLocalId, senderType: 'user', senderId: 'system', content: { t: 'system', code, data } as Prisma.InputJsonValue, mentions: [], kind: 'system' } });
        const message = toChannelMessageDto(row);
        await channelMessageUpdated(tx, channel.accountId, message);
        await channelUpdated(tx, channel.accountId, toChannelDto(channel));
        return message;
    };
    return tx ? insert(tx) : inTx(insert);
}

import { inTx } from '@/storage/inTx';
import { ChannelCreateRequestSchema, type ChannelCreateRequest } from 'happy-wire';
import * as privacyKit from 'privacy-kit';
import { teammateThreadEnsure } from '@/app/teammate/teammateThreadEnsure';
import { ChannelError } from './channelError';
import { toChannelDto } from './channelQueries';
import { channelUpdated } from './channelUpdated';

/** Validate ownership, reuse a teammate's DM, and create member keys and threads atomically. */
export async function channelCreate(accountId: string, input: ChannelCreateRequest) {
    const req = ChannelCreateRequestSchema.parse(input);
    if ((req.kind === 'dm' && req.teammates.length !== 1) || new Set(req.teammates.map(t => t.teammateId)).size !== req.teammates.length) throw new ChannelError('invalid_request');
    return inTx(async tx => {
        for (const member of req.teammates) {
            const teammate = await tx.teammate.findFirst({ where: { id: member.teammateId, accountId } });
            if (!teammate) throw new ChannelError('not_found');
            if (teammate.status === 'archived') throw new ChannelError('archived');
        }
        if (req.kind === 'dm') {
            const existing = await tx.channel.findFirst({ where: { accountId, kind: 'dm', members: { some: { teammateId: req.teammates[0].teammateId } } }, include: { members: true } });
            if (existing) return toChannelDto(existing);
        }
        const row = await tx.channel.create({ data: {
            accountId, kind: req.kind, title: req.kind === 'group' ? req.title ?? null : null, brief: req.kind === 'group' ? req.brief ?? null : null,
            members: { create: [
                { memberType: 'user', accountId, encryptedDataKey: privacyKit.decodeBase64(req.userEncryptedDataKey) },
                ...req.teammates.map(member => ({ memberType: 'teammate', teammateId: member.teammateId, encryptedDataKey: privacyKit.decodeBase64(member.encryptedDataKey) })),
            ] },
        }, include: { members: true } });
        for (const member of req.teammates) await teammateThreadEnsure(member.teammateId, req.kind, { channelId: row.id }, tx);
        const channel = toChannelDto(row);
        await channelUpdated(tx, accountId, channel);
        return channel;
    });
}

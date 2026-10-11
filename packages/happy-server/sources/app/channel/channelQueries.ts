import { db } from '@/storage/db';
import type { Channel as ChannelRow, ChannelMember, ChannelMessage as MessageRow } from '@prisma/client';
import { ChannelSchema, ChannelMessageSchema } from 'happy-wire';
import * as privacyKit from 'privacy-kit';
import { ChannelError } from './channelError';

/** Serialize member keys and dates; M1 channel creation time is encoded in its Prisma CUID. */
export function toChannelDto(row: ChannelRow & { members: ChannelMember[] }) {
    const createdAt = /^c[a-z0-9]{24}$/.test(row.id) ? parseInt(row.id.slice(1, 9), 36) : row.lastMessageAt.getTime();
    return ChannelSchema.parse({ ...row, createdAt, lastMessageAt: row.lastMessageAt.getTime(), members: row.members.map(member => ({ ...member, encryptedDataKey: privacyKit.encodeBase64(member.encryptedDataKey) })) });
}

/** Convert stored message JSON and timestamps to the shared wire schema. */
export function toChannelMessageDto(row: MessageRow) {
    return ChannelMessageSchema.parse({ ...row, createdAt: row.createdAt.getTime() });
}

/** List channels owned by the caller, newest activity first. */
export async function channelList(accountId: string) {
    return (await db.channel.findMany({ where: { accountId }, include: { members: true }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }] })).map(toChannelDto);
}

/** Hide both missing and foreign channels behind the same error. */
export async function channelGet(accountId: string, channelId: string) {
    const row = await db.channel.findFirst({ where: { id: channelId, accountId }, include: { members: true } });
    if (!row) throw new ChannelError('not_found');
    return toChannelDto(row);
}

/** Return the newest history page or the earliest page after a cursor, always ascending. */
export async function channelMessageList(accountId: string, channelId: string, options: { afterSeq?: number; beforeSeq?: number; limit?: number } = {}) {
    await channelGet(accountId, channelId);
    const ascending = options.afterSeq !== undefined;
    const rows = await db.channelMessage.findMany({
        where: { channelId, seq: { ...(options.afterSeq === undefined ? {} : { gt: options.afterSeq }), ...(options.beforeSeq === undefined ? {} : { lt: options.beforeSeq }) } },
        orderBy: { seq: ascending ? 'asc' : 'desc' }, take: Math.min(200, Math.max(1, options.limit ?? 50)),
    });
    return (ascending ? rows : rows.reverse()).map(toChannelMessageDto);
}

/** Find a teammate's DM after checking account ownership. */
export async function channelDmGet(accountId: string, teammateId: string) {
    if (!await db.teammate.findFirst({ where: { id: teammateId, accountId } })) throw new ChannelError('not_found');
    const row = await db.channel.findFirst({ where: { accountId, kind: 'dm', members: { some: { teammateId } } }, include: { members: true } });
    return row ? toChannelDto(row) : null;
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Fastify } from '@/app/api/types';

const { dbMock, state } = vi.hoisted(() => {
    const state = { channels: [] as any[], members: [] as any[], messages: [] as any[], teammates: [] as any[], threads: [] as any[], runs: [] as any[], committed: false, failCommit: false, seq: 0 };
    const matches = (row: any, where: any): boolean => !!row && (!where || Object.entries(where).every(([key, value]: [string, any]) => {
        if (key === 'teammate') return matches(state.teammates.find(t => t.id === row.teammateId), value);
        if (key === 'members') return state.members.some(m => m.channelId === row.id && matches(m, value.some));
        if (key === 'channelId_localId') return matches(row, value);
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            if ('not' in value && row[key] === value.not) return false;
            if ('in' in value && !value.in.includes(row[key])) return false;
            if ('lt' in value && !(row[key] < value.lt)) return false;
            if ('gt' in value && !(row[key] > value.gt)) return false;
            if ('lte' in value && !(row[key] <= value.lte)) return false;
            return true;
        }
        return row[key] === value;
    }));
    const apply = (row: any, data: any) => { for (const [key, value] of Object.entries(data) as any) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; return row; };
    const expandedChannel = (row: any) => row ? { ...row, members: state.members.filter(m => m.channelId === row.id).map(m => ({ ...m, teammate: state.teammates.find(t => t.id === m.teammateId) })) } : null;
    const expandedRun = (row: any) => row ? { ...row, thread: state.threads.find(t => t.id === row.threadId), teammate: state.teammates.find(t => t.id === row.teammateId) } : null;
    const findMessage = vi.fn(async ({ where, orderBy }: any) => { const rows = state.messages.filter(m => matches(m, where)); if (orderBy) rows.sort((a, b) => b.seq - a.seq); return rows[0] ?? null; });
    const dbMock = {
        channel: {
            findFirst: vi.fn(async ({ where }: any) => expandedChannel(state.channels.find(c => matches(c, where)))),
            findUnique: vi.fn(async ({ where }: any) => expandedChannel(state.channels.find(c => matches(c, where)))),
            findMany: vi.fn(async ({ where }: any) => state.channels.filter(c => matches(c, where)).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()).map(expandedChannel)),
            create: vi.fn(async ({ data }: any) => { const { members, ...rest } = data; const row = { id: `channel_${state.channels.length}`, seq: 0, lastMessageAt: new Date(), ...rest }; state.channels.push(row); members.create.forEach((m: any) => state.members.push({ id: `member_${state.members.length}`, channelId: row.id, accountId: null, teammateId: null, lastReadSeq: 0, ...m })); return expandedChannel(row); }),
            update: vi.fn(async ({ where, data }: any) => expandedChannel(apply(state.channels.find(c => matches(c, where)), data))),
            updateMany: vi.fn(async ({ where, data }: any) => { const rows = state.channels.filter(c => matches(c, where)); rows.forEach(c => apply(c, data)); return { count: rows.length }; }),
        },
        channelMember: { update: vi.fn(async ({ where, data }: any) => apply(state.members.find(m => matches(m, where)), data)) },
        channelMessage: {
            findFirst: findMessage, findUnique: findMessage,
            findMany: vi.fn(async ({ where, orderBy, take }: any) => state.messages.filter(m => matches(m, where)).sort((a, b) => orderBy.seq === 'asc' ? a.seq - b.seq : b.seq - a.seq).slice(0, take)),
            count: vi.fn(async ({ where }: any) => state.messages.filter(m => matches(m, where)).length),
            create: vi.fn(async ({ data }: any) => { const row = { id: `message_${state.messages.length}`, createdAt: new Date(), localId: null, taskId: null, runId: null, ...data }; state.messages.push(row); return row; }),
        },
        teammate: {
            findFirst: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null),
            findUnique: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null),
        },
        teammateTask: { findFirst: vi.fn(async () => null) },
        teammateThread: {
            findFirst: vi.fn(async ({ where }: any) => state.threads.find(t => matches(t, where)) ?? null),
            create: vi.fn(async ({ data }: any) => { const row = { id: `thread_${state.threads.length}`, taskId: null, channelId: null, resetAt: null, ...data }; state.threads.push(row); return row; }),
            updateMany: vi.fn(async ({ where, data }: any) => { const rows = state.threads.filter(t => matches(t, where)); rows.forEach(t => apply(t, data)); return { count: rows.length }; }),
        },
        teammateRun: {
            findFirst: vi.fn(async ({ where }: any) => expandedRun(state.runs.find(r => matches(r, where)))),
            update: vi.fn(async ({ where, data }: any) => expandedRun(apply(state.runs.find(r => matches(r, where)), data))),
            create: vi.fn(async ({ data }: any) => { const row = { id: `run_${state.runs.length}`, sessionId: null, costUsd: null, startedAt: null, finishedAt: null, failureReason: null, queuedAt: new Date(), ...data }; state.runs.push(row); return expandedRun(row); }),
        },
        account: { update: vi.fn(async () => ({ seq: ++state.seq })) },
        $transaction: vi.fn(async (fn: any) => { state.committed = false; const result = await fn(dbMock); if (state.failCommit) throw new Error('commit failed'); state.committed = true; return result; }),
    };
    return { dbMock, state };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import { channelCreate } from './channelCreate';
import { channelMessageSend } from './channelMessageSend';
import { channelReset } from './channelReset';
import { channelMarkRead } from './channelMarkRead';
import { channelMemberKeyUpdate } from './channelMemberKeyUpdate';
import { channelSystemMessage } from './channelSystemMessage';
import { channelMessageList, toChannelDto } from './channelQueries';
import { eventRouter } from '@/app/events/eventRouter';
import { channelRoutes } from '@/app/api/routes/channelRoutes';

const now = new Date('2026-10-09T12:00:00Z');
const createReq = { kind: 'dm' as const, userEncryptedDataKey: 'AQI=', teammates: [{ teammateId: 'mate', encryptedDataKey: 'AwQ=' }] };
const user = { type: 'user' as const, accountId: 'account' };
const req = (localId: string, mentions: string[] = []) => ({ localId, content: { t: 'encrypted' as const, c: 'ciphertext' }, mentions });
async function send(channelId: string, localId: string, mentions: string[] = [], sender: any = user) {
    return channelMessageSend({ accountId: 'account', channelId, sender, req: req(localId, mentions) });
}
function senderRun(channelId: string, teammateId = 'mate', overrides: any = {}) {
    const thread = state.threads.find(t => t.channelId === channelId && t.teammateId === teammateId);
    const row = { id: `sender_${state.runs.length}`, teammateId, threadId: thread.id, status: 'running', dispatchToken: 'secret', finishedAt: null, ...overrides };
    state.runs.push(row);
    return { type: 'teammate' as const, teammateId, runId: row.id };
}
async function group() {
    return channelCreate('account', { ...createReq, kind: 'group', title: 'Engineering', teammates: [...createReq.teammates, { teammateId: 'other', encryptedDataKey: 'BQY=' }] });
}
beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
    state.channels = []; state.members = []; state.messages = []; state.threads = []; state.runs = []; state.seq = 0; state.committed = false; state.failCommit = false;
    state.teammates = [{ id: 'mate', accountId: 'account', status: 'active' }, { id: 'other', accountId: 'account', status: 'active' }];
    vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => { expect(state.committed).toBe(true); return { total: 1, sessionScoped: 0 }; });
});
afterEach(() => vi.useRealTimers());

describe('channelCreate', () => {
    it('reuses a DM unchanged, including its original wrapped keys and thread', async () => {
        const first = await channelCreate('account', createReq);
        const again = await channelCreate('account', { ...createReq, userEncryptedDataKey: 'Bw==' });
        expect(again).toEqual(first); expect(first.members[0].encryptedDataKey).toBe('AQI=');
        expect(state.channels).toHaveLength(1); expect(state.threads).toMatchObject([{ teammateId: 'mate', kind: 'dm', channelId: first.id }]);
        expect(dbMock.channel.create).toHaveBeenCalledTimes(1); expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(1);
    });
    it('ensures a group thread for each member', async () => {
        const channel = await group(); expect(channel.title).toBe('Engineering');
        expect(state.threads).toMatchObject([{ teammateId: 'mate', kind: 'group', channelId: channel.id }, { teammateId: 'other', kind: 'group', channelId: channel.id }]);
    });
    it.each(['foreign', 'archived'])('rejects %s teammates before creating a channel', async mode => {
        if (mode === 'foreign') state.teammates[0].accountId = 'foreign'; else state.teammates[0].status = 'archived';
        await expect(channelCreate('account', createReq)).rejects.toMatchObject({ code: mode === 'foreign' ? 'not_found' : 'archived' });
        expect(dbMock.channel.create).not.toHaveBeenCalled();
    });
    it('rejects multi-member DMs and duplicate members', async () => {
        await expect(channelCreate('account', { ...createReq, teammates: [...createReq.teammates, createReq.teammates[0]] })).rejects.toMatchObject({ code: 'invalid_request' });
        await expect(channelCreate('account', { ...createReq, kind: 'group', teammates: [...createReq.teammates, createReq.teammates[0]] })).rejects.toMatchObject({ code: 'invalid_request' });
    });
    it('does not emit when commit fails', async () => {
        state.failCommit = true; await expect(channelCreate('account', createReq)).rejects.toThrow('commit failed'); expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
});

describe('channelMessageSend', () => {
    it('increments seq, deduplicates localId, and coalesces DM events in one queued run', async () => {
        const channel = await channelCreate('account', createReq);
        const first = await send(channel.id, 'one'); const second = await send(channel.id, 'two');
        const duplicate = await send(channel.id, 'one');
        expect([first.seq, second.seq]).toEqual([1, 2]); expect(duplicate).toEqual(first); expect(state.messages).toHaveLength(2); expect(state.channels[0].seq).toBe(2);
        expect(state.runs).toHaveLength(1); expect(state.runs[0].trigger).toBe('channel-message');
        expect(state.runs[0].eventPayload.events.map((e: any) => e.data)).toEqual([{ channelId: channel.id, messageId: first.id, seq: 1 }, { channelId: channel.id, messageId: second.id, seq: 2 }]);
        expect(vi.mocked(eventRouter.emitUpdate).mock.calls.filter(([e]) => e.payload.body.t === 'new-channel-message')).toHaveLength(2);
    });
    it('a teammate DM does not route, and activity is updated after commit', async () => {
        const channel = await channelCreate('account', createReq); vi.setSystemTime(new Date(now.getTime() + 1000));
        await send(channel.id, 'reply', ['mate'], senderRun(channel.id));
        expect(dbMock.teammateRun.create).not.toHaveBeenCalled(); expect(state.channels[0].lastMessageAt.getTime()).toBe(now.getTime() + 1000);
    });
    it('groups route only mentioned members, drop foreign mentions and exclude the sender', async () => {
        const channel = await group(); const sender = senderRun(channel.id);
        const message = await send(channel.id, 'reply', ['mate', 'other', 'foreign', 'other'], sender);
        expect(message.mentions).toEqual(['mate', 'other']);
        expect(dbMock.teammateRun.create).toHaveBeenCalledTimes(1); expect(state.runs[1].teammateId).toBe('other');
    });
    it('unmentioned group members receive no runs', async () => {
        const channel = await group(); await send(channel.id, 'hello'); expect(state.runs).toHaveLength(0);
    });
    it('stops on the fifth teammate message and posts exactly one guard through the sixth', async () => {
        const channel = await group(); const sender = senderRun(channel.id);
        for (let i = 1; i <= 4; i++) await send(channel.id, `hop${i}`, ['other'], sender);
        expect(state.runs[1].eventPayload.events).toHaveLength(4);
        await send(channel.id, 'hop5', ['other'], sender); await send(channel.id, 'hop6', ['other'], sender);
        expect(state.runs[1].eventPayload.events).toHaveLength(4);
        expect(state.messages.filter(m => m.content.code === 'loop_guard')).toHaveLength(1);
        expect(state.messages.map(m => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        await send(channel.id, 'human', ['other']); await send(channel.id, 'new-hop', ['other'], sender);
        expect(state.runs[1].eventPayload.events).toHaveLength(6);
        for (let i = 2; i <= 5; i++) await send(channel.id, `new-hop${i}`, ['other'], sender);
        expect(state.messages.filter(m => m.content.code === 'loop_guard')).toHaveLength(2);
    });
    it('system messages do not break the teammate streak', async () => {
        const channel = await group(); const sender = senderRun(channel.id);
        for (let i = 0; i < 4; i++) await send(channel.id, `hop${i}`, [], sender);
        await channelSystemMessage(channel.id, 'member_added', {});
        await send(channel.id, 'fifth', ['other'], sender);
        expect(dbMock.teammateRun.create).not.toHaveBeenCalled(); expect(state.messages.filter(m => m.content.code === 'loop_guard')).toHaveLength(1);
    });
    it('rejects foreign channels, non-member senders and mismatched runs', async () => {
        const channel = await channelCreate('account', createReq);
        await expect(channelMessageSend({ accountId: 'foreign', channelId: channel.id, sender: user, req: req('foreign') })).rejects.toMatchObject({ code: 'not_found' });
        await expect(send(channel.id, 'non-member', [], { type: 'teammate', teammateId: 'other', runId: 'run' })).rejects.toMatchObject({ code: 'invalid_sender' });
        const sender = senderRun(channel.id); state.runs[0].teammateId = 'other';
        await expect(send(channel.id, 'wrong-run', [], sender)).rejects.toMatchObject({ code: 'invalid_sender' });
        expect(state.messages).toHaveLength(0);
    });
    it('reserves system localIds so users cannot suppress guard messages', async () => {
        const channel = await group();
        await expect(send(channel.id, 'system:loop_guard:0')).rejects.toMatchObject({ code: 'invalid_request' });
        expect(state.messages).toHaveLength(0);
    });
    it('skips archived teammate recipients', async () => {
        const channel = await group(); state.teammates[1].status = 'archived';
        await send(channel.id, 'hello', ['other']); expect(dbMock.teammateRun.create).not.toHaveBeenCalled();
    });
    it('does not route or emit after failed commit', async () => {
        const channel = await group(); vi.mocked(eventRouter.emitUpdate).mockClear(); state.failCommit = true;
        await expect(send(channel.id, 'fail', ['mate'])).rejects.toThrow('commit failed'); expect(eventRouter.emitUpdate).not.toHaveBeenCalled(); expect(dbMock.teammateRun.create).not.toHaveBeenCalled();
    });
});

describe('channel reset, read, key and DTOs', () => {
    it('sets resetAt for every channel thread and posts context_reset once on consecutive retries', async () => {
        const channel = await group(); await channelReset('account', channel.id); await channelReset('account', channel.id);
        expect(state.threads.map(t => t.resetAt)).toEqual([now, now]); expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({ senderType: 'user', senderId: 'system', kind: 'system', content: { t: 'system', code: 'context_reset', data: { resetAt: now.getTime() } } });
    });
    it('system message retries reuse the same localId and sequence', async () => {
        const channel = await group();
        const first = await channelSystemMessage(channel.id, 'member_added', { teammateId: 'mate' });
        expect(await channelSystemMessage(channel.id, 'member_added', { teammateId: 'mate' })).toEqual(first);
        expect(state.messages).toHaveLength(1); expect(state.channels[0].seq).toBe(1);
    });
    it('advances read monotonically and clamps to the channel seq', async () => {
        const channel = await channelCreate('account', createReq); await send(channel.id, 'one'); await send(channel.id, 'two');
        await channelMarkRead('account', channel.id, 100); await channelMarkRead('account', channel.id, 1);
        expect(state.members[0].lastReadSeq).toBe(2); expect(dbMock.channelMember.update).toHaveBeenCalledTimes(1);
    });
    it('updates wrapped keys once and rejects foreign channels and missing members', async () => {
        const channel = await channelCreate('account', createReq);
        await channelMemberKeyUpdate('account', channel.id, 'mate', 'BQY='); await channelMemberKeyUpdate('account', channel.id, 'mate', 'BQY=');
        expect(state.members[1].encryptedDataKey).toEqual(new Uint8Array([5, 6])); expect(dbMock.channelMember.update).toHaveBeenCalledTimes(1);
        await expect(channelMemberKeyUpdate('foreign', channel.id, 'mate', 'AA==')).rejects.toMatchObject({ code: 'not_found' });
        await expect(channelMemberKeyUpdate('account', channel.id, 'other', 'AA==')).rejects.toMatchObject({ code: 'not_found' });
    });
    it('returns history pages ascending and applies exclusive cursors', async () => {
        const channel = await channelCreate('account', createReq); for (let i = 1; i <= 4; i++) await send(channel.id, `${i}`);
        expect((await channelMessageList('account', channel.id, { limit: 2 })).map(m => m.seq)).toEqual([3, 4]);
        expect((await channelMessageList('account', channel.id, { afterSeq: 1, beforeSeq: 4, limit: 2 })).map(m => m.seq)).toEqual([2, 3]);
    });
    it('keeps CUID creation time stable as last activity changes', () => {
        const id = `c${now.getTime().toString(36)}0000000000000000`;
        const dto = toChannelDto({ id, kind: 'dm', title: null, seq: 1, accountId: 'account', members: [], lastMessageAt: new Date(now.getTime() + 10_000) });
        expect(dto.createdAt).toBe(now.getTime()); expect(dto.lastMessageAt).toBe(now.getTime() + 10_000);
    });
});

describe('channel routes', () => {
    let app: ReturnType<typeof fastify>;
    const headers = { authorization: 'Bearer account' };
    beforeEach(async () => {
        vi.useRealTimers();
        app = fastify().withTypeProvider<ZodTypeProvider>(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => { if (request.headers.authorization !== 'Bearer account') return reply.code(401).send({ error: 'unauthorized' }); (request as FastifyRequest & { userId: string }).userId = 'account'; });
        channelRoutes(app as unknown as Fastify); await app.ready();
    });
    afterEach(async () => { await app.close(); });
    it('rejects an invalid daemon token with 403', async () => {
        const channel = await channelCreate('account', createReq); const sender = senderRun(channel.id);
        const response = await app.inject({ method: 'POST', url: '/v1/teammate-channel-messages', headers, payload: { ...req('reply'), runId: sender.runId, dispatchToken: 'wrong' } });
        expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'invalid_token' }); expect(state.messages).toHaveLength(0);
    });
    it.each(['completed', 'failed', 'cancelled'])('rejects %s runs finished more than one hour ago', async status => {
        const channel = await channelCreate('account', createReq); const sender = senderRun(channel.id, 'mate', { status, finishedAt: new Date(Date.now() - 3_600_001) });
        const response = await app.inject({ method: 'POST', url: '/v1/teammate-channel-messages', headers, payload: { ...req('reply'), runId: sender.runId, dispatchToken: 'secret' } });
        expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'run_expired' });
    });
    it.each(['running', 'completed'])('accepts valid %s run replies', async status => {
        const channel = await channelCreate('account', createReq); const sender = senderRun(channel.id, 'mate', { status, finishedAt: status === 'completed' ? new Date(Date.now() - 3_599_000) : null });
        const response = await app.inject({ method: 'POST', url: '/v1/teammate-channel-messages', headers, payload: { ...req('reply'), runId: sender.runId, dispatchToken: 'secret' } });
        expect(response.statusCode).toBe(200); expect(response.json().message).toMatchObject({ senderType: 'teammate', senderId: 'mate', runId: sender.runId });
    });
    it('serves create/list/get/DM/messages/read/reset/key endpoints', async () => {
        expect((await app.inject({ method: 'GET', url: '/v1/teammates/mate/dm', headers })).json()).toEqual({ channel: null });
        const created = await app.inject({ method: 'POST', url: '/v1/channels', headers, payload: createReq }); expect(created.statusCode).toBe(200); const channel = created.json().channel;
        expect((await app.inject({ method: 'GET', url: '/v1/channels', headers })).json().channels).toHaveLength(1);
        expect((await app.inject({ method: 'GET', url: `/v1/channels/${channel.id}`, headers })).json()).toEqual({ channel });
        expect((await app.inject({ method: 'GET', url: '/v1/teammates/mate/dm', headers })).json()).toEqual({ channel });
        expect((await app.inject({ method: 'POST', url: `/v1/channels/${channel.id}/messages`, headers, payload: req('one') })).statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: `/v1/channels/${channel.id}/messages?afterSeq=0&limit=50`, headers })).json().messages).toHaveLength(1);
        for (const [suffix, payload] of [['read', { seq: 1 }], ['reset', undefined], ['members/mate/key', { encryptedDataKey: 'AA==' }]] as const) {
            expect((await app.inject({ method: 'POST', url: `/v1/channels/${channel.id}/${suffix}`, headers, payload })).json()).toEqual({ ok: true });
        }
    });
    it('validates history limits and hides foreign resources', async () => {
        expect((await app.inject({ method: 'GET', url: '/v1/channels/missing/messages?limit=201', headers })).statusCode).toBe(400);
        const channel = await channelCreate('account', createReq); state.channels[0].accountId = 'foreign';
        expect((await app.inject({ method: 'GET', url: `/v1/channels/${channel.id}`, headers })).statusCode).toBe(404);
    });
    it.each([
        ['GET', '/v1/channels'], ['POST', '/v1/channels'], ['GET', '/v1/channels/id'], ['GET', '/v1/channels/id/messages'], ['POST', '/v1/channels/id/messages'], ['POST', '/v1/channels/id/read'], ['POST', '/v1/channels/id/reset'], ['POST', '/v1/channels/id/members/mate/key'], ['POST', '/v1/teammate-channel-messages'], ['GET', '/v1/teammates/mate/dm'],
    ] as const)('authenticates %s %s', async (method, url) => {
        const payload = url === '/v1/channels' && method === 'POST' ? createReq : url === '/v1/teammate-channel-messages' ? { ...req('one'), runId: 'run', dispatchToken: 'secret' } : url.endsWith('/messages') && method === 'POST' ? req('one') : url.endsWith('/read') ? { seq: 0 } : url.endsWith('/key') ? { encryptedDataKey: 'AA==' } : undefined;
        expect((await app.inject({ method, url, payload })).statusCode).toBe(401);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import * as api from './apiChannels';
import { ApiUpdateContainerSchema } from './apiTypes';
import { testChannel as channel, testChannelMessage as message } from './channelTestFixtures';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('@/utils/time', () => ({ backoff: async (callback: () => Promise<unknown>) => {
    for (let i = 0; i < 5; i++) { try { return await callback(); } catch (error) { if (i === 4) throw error; } }
} }));
const credentials = { token: 'token' } as AuthCredentials;
const fetchMock = vi.fn();
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('channel API', () => {
    it('covers all nine user routes, auth, ID encoding and pagination', async () => {
        respond({ channels: [channel] }); expect(await api.fetchChannels(credentials)).toEqual([channel]);
        respond({ channel }); expect(await api.createChannel(credentials, { kind: 'group', title: 'Team', userEncryptedDataKey: 'u', teammates: [{ teammateId: 'a', encryptedDataKey: 'a' }] })).toEqual(channel);
        respond({ channel }); expect(await api.fetchChannel(credentials, channel.id)).toEqual(channel);
        respond({ messages: [message] }); expect(await api.fetchChannelMessages(credentials, channel.id, { afterSeq: 1, beforeSeq: 10, limit: 999 })).toEqual([message]);
        respond({ message }); expect(await api.sendChannelMessage(credentials, channel.id, { localId: 'local', content: { t: 'encrypted', c: 'c' } })).toEqual(message);
        respond({ ok: true }); await api.markChannelRead(credentials, channel.id, { seq: 2 });
        respond({ ok: true }); await api.resetChannel(credentials, channel.id);
        respond({ ok: true }); await api.updateChannelMemberKey(credentials, channel.id, 'agent/1', { encryptedDataKey: 'new' });
        respond({ channel: null }); expect(await api.fetchTeammateDm(credentials, 'agent/1')).toBeNull();
        const paths = fetchMock.mock.calls.map(([url]) => String(url).replace('https://happy.test/v1/', ''));
        expect(paths).toEqual(['channels','channels','channels/chat%2Fwith%20space','channels/chat%2Fwith%20space/messages?afterSeq=1&beforeSeq=10&limit=200',
            'channels/chat%2Fwith%20space/messages','channels/chat%2Fwith%20space/read','channels/chat%2Fwith%20space/reset',
            'channels/chat%2Fwith%20space/members/agent%2F1/key','teammates/agent%2F1/dm']);
        expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET','POST','GET','GET','POST','POST','POST','POST','GET']);
        for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBe('Bearer token');
        expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ localId: 'local', content: { t: 'encrypted', c: 'c' }, mentions: [], kind: 'text' });
        expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({ seq: 2 });
        expect(JSON.parse(fetchMock.mock.calls[7][1].body)).toEqual({ encryptedDataKey: 'new' });
    });
    it('validates create/send/read requests before the network call', async () => {
        await expect(api.createChannel(credentials, { kind: 'group', userEncryptedDataKey: 'k', teammates: [] })).rejects.toThrow();
        await expect(api.sendChannelMessage(credentials, 'c', { localId: '', content: { t: 'encrypted', c: 'x' } })).rejects.toThrow();
        await expect(api.markChannelRead(credentials, 'c', { seq: -1 })).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['list','get','create','history','send','dm','read','reset','key'])('validates %s responses', async endpoint => {
        respond({});
        const operations: Record<string, () => Promise<unknown>> = {
            list: () => api.fetchChannels(credentials), get: () => api.fetchChannel(credentials, 'c'),
            create: () => api.createChannel(credentials, { kind: 'dm', userEncryptedDataKey: 'u', teammates: [{ teammateId: 'a', encryptedDataKey: 'a' }] }),
            history: () => api.fetchChannelMessages(credentials, 'c'), send: () => api.sendChannelMessage(credentials, 'c', { localId: 'l', content: { t: 'encrypted', c: 'c' } }),
            dm: () => api.fetchTeammateDm(credentials, 'a'), read: () => api.markChannelRead(credentials, 'c', { seq: 1 }),
            reset: () => api.resetChannel(credentials, 'c'), key: () => api.updateChannelMemberKey(credentials, 'c', 'a', { encryptedDataKey: 'k' }),
        };
        await expect(operations[endpoint]()).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('bounds GET retries and does not replay writes or retry 4xx', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
        await expect(api.fetchChannels(credentials)).rejects.toMatchObject({ status: 503 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        fetchMock.mockReset(); fetchMock.mockRejectedValue(new Error('lost response'));
        await expect(api.resetChannel(credentials, 'c')).rejects.toThrow('lost response');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockReset(); respond({ error: 'not_found' }, 404);
        await expect(api.fetchChannel(credentials, 'c')).rejects.toMatchObject({ status: 404, code: 'not_found' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('accepts both socket event envelopes and rejects invalid content', () => {
        const envelope = { id: 'update', seq: 1, createdAt: 0 };
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { t: 'channel-updated', channel } }).success).toBe(true);
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { t: 'new-channel-message', message } }).success).toBe(true);
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { t: 'new-channel-message', message: { ...message, content: { t: 'plaintext', text: 'no' } } } }).success).toBe(false);
    });
});

it('sends the taskId through the validated channel body', async () => {
    respond({ message: { ...message, taskId: 'task' } });
    await api.sendChannelMessage(credentials, channel.id, { localId: 'local', content: { t: 'encrypted', c: 'c' }, taskId: 'task' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).taskId).toBe('task');
});

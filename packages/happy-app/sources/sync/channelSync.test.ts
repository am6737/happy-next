import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { Encryption } from './encryption/encryption';
import type { Channel, Teammate } from 'happy-wire';
import type { StoredChannelMessage } from './channelReducers';
import { mergeChannels, mergeChannelMessages } from './channelReducers';
import { ChannelSync } from './channelSync';
import { testChannel as channel, testChannelMessage as message } from './channelTestFixtures';
import * as api from './apiChannels';
import * as crypto from './channelEncryption';

vi.mock('./apiChannels', () => ({ fetchChannels: vi.fn(), createChannel: vi.fn(), fetchTeammateDm: vi.fn(), fetchChannel: vi.fn(), fetchChannelMessages: vi.fn(), sendChannelMessage: vi.fn(), markChannelRead: vi.fn(), resetChannel: vi.fn(), updateChannelMemberKey: vi.fn(), updateChannel: vi.fn(), addChannelMembers: vi.fn(), removeChannelMember: vi.fn(), deleteChannel: vi.fn() }));
vi.mock('./channelEncryption', () => ({ generateChannelKey: vi.fn(() => new Uint8Array(32).fill(1)), wrapChannelKeyForAccount: vi.fn(() => 'candidate-key'), wrapChannelKeyForTeammate: vi.fn(async () => 'new-agent-key'), unwrapChannelKey: vi.fn(async () => new Uint8Array(32).fill(2)), encryptChannelMessage: vi.fn(async () => ({ t: 'encrypted', c: 'ciphertext' })), decryptChannelMessage: vi.fn(async () => ({ text: 'decrypted' })), encryptChannelBrief: vi.fn(async () => 'brief-ciphertext'), decryptChannelBrief: vi.fn(async () => 'Brief text') }));
vi.mock('./apiTeammates', () => ({ fetchTeammateRuns: vi.fn(async () => []), fetchTeammateTasks: vi.fn(async () => []) }));
const harness = vi.hoisted(() => ({ state: {} as any, server: 'https://test' }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => harness.server }));
vi.mock('./storage', () => ({ storage: { getState: () => harness.state, setState: (fn: any) => Object.assign(harness.state, typeof fn === 'function' ? fn(harness.state) : fn) } }));
const credentials = { token: 'token' } as AuthCredentials;
const encryption = { generateId: () => 'local', contentDataKey: new Uint8Array(32), decryptEncryptionKey: vi.fn() } as unknown as Encryption;
const agent = { id: 'agent/1', machineId: 'new-machine' } as Teammate;
const machineKey = new Uint8Array(32).fill(3);
let client: ChannelSync;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
    vi.clearAllMocks(); harness.server = 'https://test';
    harness.state = { channels: { [channel.id]: channel }, channelsLoaded: false, channelMessages: {}, profile: { id: 'owner' }, teammateRuns: {},
        applyChannels: (incoming: Channel[], loaded = false, baseline?: Record<string, Channel>) => {
            harness.state.channels = mergeChannels(harness.state.channels, incoming, baseline); harness.state.channelsLoaded ||= loaded;
        },
        applyChannelMessages: (id: string, incoming: StoredChannelMessage[]) => {
            harness.state.channelMessages[id] = mergeChannelMessages(harness.state.channelMessages[id], incoming);
        }, markChannelReadLocal: vi.fn(), applyTeammateActivity: vi.fn(),
        removeChannel: (id: string) => { delete harness.state.channels[id]; delete harness.state.channelMessages[id]; },
    };
    client = new ChannelSync(() => ({ credentials, encryption }), async () => machineKey);
    vi.mocked(api.fetchChannel).mockResolvedValue(channel);
    vi.mocked(api.fetchChannelMessages).mockResolvedValue([]);
});

it('encrypts a group brief with the channel key, clears blank text and reads it back', async () => {
    vi.mocked(api.updateChannel).mockResolvedValue({ ...channel, brief: 'brief-ciphertext' });
    await client.setBrief(channel.id, '  Builder implements.  ');
    expect(crypto.encryptChannelBrief).toHaveBeenCalledWith(new Uint8Array(32).fill(2), 'Builder implements.');
    expect(api.updateChannel).toHaveBeenLastCalledWith(credentials, channel.id, { brief: 'brief-ciphertext' });
    expect(await client.readBrief(harness.state.channels[channel.id])).toBe('Brief text');
    await client.setBrief(channel.id, '   ');
    expect(api.updateChannel).toHaveBeenLastCalledWith(credentials, channel.id, { brief: null });
    expect(await client.readBrief(channel)).toBeNull();
});

it('supports group settings actions and wraps the existing channel key', async () => {
    vi.mocked(api.updateChannel).mockResolvedValue(channel);
    vi.mocked(api.addChannelMembers).mockResolvedValue(channel);
    vi.mocked(api.removeChannelMember).mockResolvedValue(channel);
    vi.mocked(api.deleteChannel).mockResolvedValue(undefined);
    await client.rename(channel.id, 'New');
    await client.addMembers(channel.id, [agent, { ...agent, id: 'agent/2' }]);
    expect(crypto.unwrapChannelKey).toHaveBeenCalledWith(encryption, 'user-key');
    expect(crypto.wrapChannelKeyForTeammate).toHaveBeenCalledWith(new Uint8Array(32).fill(2), machineKey);
    expect(api.addChannelMembers).toHaveBeenCalled();
    await client.removeMember(channel.id, agent.id);
    await client.delete(channel.id);
    expect(harness.state.channels[channel.id]).toBeUndefined();
});
describe('channel sync races and key updates', () => {
    it('uses the returned DM key when idempotent creation returns an existing channel', async () => {
        vi.mocked(api.fetchTeammateDm).mockResolvedValue(null); vi.mocked(api.createChannel).mockResolvedValue(channel);
        expect(await client.openDm(agent)).toEqual(channel);
        vi.mocked(api.sendChannelMessage).mockResolvedValue(message);
        await client.send(channel.id, { text: 'hello' }, []);
        expect(crypto.unwrapChannelKey).toHaveBeenCalledWith(encryption, 'user-key');
        expect(api.createChannel).toHaveBeenCalledWith(credentials, expect.objectContaining({ userEncryptedDataKey: 'candidate-key' }));
    });
    it('inserts optimistically, merges the socket echo, and ignores a late HTTP failure', async () => {
        const response = deferred<any>(); vi.mocked(api.sendChannelMessage).mockReturnValue(response.promise);
        const send = client.send(channel.id, { text: 'hello' }, []);
        await vi.waitFor(() => expect(harness.state.channelMessages[channel.id]?.[0]?.delivery).toBe('pending'));
        await client.applyMessages(channel.id, [message]);
        response.resolve(Promise.reject(new Error('response lost')));
        await expect(send).resolves.toMatchObject({ id: message.id });
        expect(harness.state.channelMessages[channel.id]).toEqual([{ ...message, body: { text: 'hello' } }]);
    });
    it('retries a failed send with identical localId and ciphertext', async () => {
        vi.mocked(api.sendChannelMessage).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(message);
        await expect(client.send(channel.id, { text: 'hello' }, ['agent/1'])).rejects.toThrow();
        expect(harness.state.channelMessages[channel.id][0].delivery).toBe('failed');
        await client.send(channel.id, { text: 'hello' }, ['agent/1'], 'local');
        expect(api.sendChannelMessage).toHaveBeenNthCalledWith(2, credentials, channel.id, vi.mocked(api.sendChannelMessage).mock.calls[0][2]);
        expect(crypto.encryptChannelMessage).toHaveBeenCalledTimes(1);
    });
    it('does not apply a response after a server switch', async () => {
        const response = deferred<Channel[]>(); vi.mocked(api.fetchChannels).mockReturnValue(response.promise);
        const refresh = client.refresh(); harness.server = 'https://other'; response.resolve([{ ...channel, id: 'stale' }]); await refresh;
        expect(harness.state.channels.stale).toBeUndefined(); expect(harness.state.channelsLoaded).toBe(false);
    });
    it('rewraps every member channel using its original K and the new bound machine key', async () => {
        const second = { ...channel, id: 'second' };
        const unrelated = { ...channel, id: 'other', members: channel.members.filter(m => m.memberType === 'user') };
        vi.mocked(api.fetchChannels).mockResolvedValue([channel, second, unrelated]);
        vi.mocked(api.updateChannelMemberKey).mockResolvedValue(undefined);
        await client.rewrapMember(agent);
        expect(api.updateChannelMemberKey).toHaveBeenCalledTimes(2);
        expect(api.updateChannelMemberKey).toHaveBeenCalledWith(credentials, 'second', agent.id, { encryptedDataKey: 'new-agent-key' });
        expect(crypto.wrapChannelKeyForTeammate).toHaveBeenCalledWith(new Uint8Array(32).fill(2), machineKey);
    });
    it('caches decrypted bodies across duplicate history/socket deliveries', async () => {
        await client.applyMessages(channel.id, [message]); await client.applyMessages(channel.id, [message]);
        expect(crypto.decryptChannelMessage).toHaveBeenCalledTimes(1);
        expect(harness.state.channelMessages[channel.id]).toHaveLength(1);
    });
    it('refreshes visible channels on reconnect and releases the watch on blur', async () => {
        vi.mocked(api.fetchChannels).mockResolvedValue([channel]);
        const stop = client.watch(channel.id);
        await client.refresh(); expect(api.fetchChannel).toHaveBeenCalledTimes(1);
        stop(); await client.refresh(); expect(api.fetchChannel).toHaveBeenCalledTimes(1);
    });
});

it('fills history gaps when a newer socket message was cached before focus', async () => {
    harness.state.channelMessages[channel.id] = [{ ...message, id: 'old', seq: 2, localId: null }, { ...message, id: 'socket', seq: 210, localId: null }];
    vi.mocked(api.fetchChannelMessages)
        .mockResolvedValueOnce([{ ...message, id: 'latest', seq: 211, localId: null }])
        .mockResolvedValueOnce(Array.from({ length: 200 }, (_, n) => ({ ...message, id: `m${n + 3}`, seq: n + 3, localId: null })))
        .mockResolvedValueOnce(Array.from({ length: 7 }, (_, n) => ({ ...message, id: `m${n + 203}`, seq: n + 203, localId: null })));
    await client.load(channel.id);
    expect(api.fetchChannelMessages).toHaveBeenNthCalledWith(2, credentials, channel.id, { afterSeq: 2, beforeSeq: 210, limit: 200 });
    expect(api.fetchChannelMessages).toHaveBeenNthCalledWith(3, credentials, channel.id, { afterSeq: 202, beforeSeq: 210, limit: 200 });
    expect(harness.state.channelMessages[channel.id].map((m: StoredChannelMessage) => m.seq)).toEqual(Array.from({ length: 210 }, (_, n) => n + 2));
});

it('preserves task routing in optimistic messages and retries, even if the chip target changes', async () => {
    vi.mocked(api.sendChannelMessage).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...message, taskId: 'task' });
    await expect(client.send(channel.id, { text: 'yes' }, [], undefined, undefined, 'task')).rejects.toThrow('offline');
    expect(harness.state.channelMessages[channel.id][0]).toMatchObject({ taskId: 'task', delivery: 'failed' });
    await client.send(channel.id, { text: 'yes' }, [], 'local', undefined, 'other');
    expect(api.sendChannelMessage).toHaveBeenNthCalledWith(2, credentials, channel.id,
        expect.objectContaining({ taskId: 'task', localId: 'local' }));
    expect(crypto.encryptChannelMessage).toHaveBeenCalledTimes(1);
});

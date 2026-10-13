import type { Channel, ChannelMessage, ChannelMessageBody, Teammate } from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { Encryption } from './encryption/encryption';
import { storage } from './storage';
import { getServerUrl } from './serverConfig';
import * as api from './apiChannels';
import { decryptChannelBrief, decryptChannelMessage, encryptChannelBrief, encryptChannelMessage, generateChannelKey, unwrapChannelKey, wrapChannelKeyForAccount, wrapChannelKeyForTeammate } from './channelEncryption';
import { fetchTeammateRuns, fetchTeammateTasks } from './apiTeammates';
import type { StoredChannelMessage } from './channelReducers';

/** Account/server guards also cover decryption awaits and late HTTP responses. */
export class ChannelSync {
    constructor(private readonly getContext: () => { credentials: AuthCredentials; encryption: Encryption },
        readonly getMachineKey: (id: string) => Promise<Uint8Array>) {}
    private visible = new Set<string>();
    /** Unwrapped channel keys by wrapped key, per account encryption. */
    private keys = new WeakMap<Encryption, Map<string, Promise<Uint8Array>>>();
    watch(id: string) { this.visible.add(id); return () => { this.visible.delete(id); }; }
    private context() {
        const { credentials, encryption } = this.getContext();
        const server = getServerUrl();
        const valid = () => {
            const current = this.getContext();
            return credentials === current.credentials && encryption === current.encryption && server === getServerUrl();
        };
        return { credentials, encryption, valid, assertValid: () => { if (!valid()) throw new Error('Account changed'); } };
    }
    refresh = async () => {
        const context = this.context();
        if (!context.credentials) return;
        const snapshot = storage.getState().channels;
        const channels = await api.fetchChannels(context.credentials);
        if (!context.valid()) return;
        storage.getState().applyChannels(channels, true, snapshot);
        for (const id of this.visible) { if (!context.valid()) return; await this.load(id); }
    };
    private async key(channel: Channel, encryption: Encryption) {
        const member = channel.members.find(m => m.memberType === 'user' && m.accountId === storage.getState().profile.id)
            ?? channel.members.find(m => m.memberType === 'user');
        if (!member) throw new Error('Missing user channel key');
        let keys = this.keys.get(encryption);
        if (!keys) { keys = new Map(); this.keys.set(encryption, keys); }
        let key = keys.get(member.encryptedDataKey);
        if (!key) {
            key = unwrapChannelKey(encryption, member.encryptedDataKey);
            keys.set(member.encryptedDataKey, key);
            key.catch(() => keys.delete(member.encryptedDataKey));
        }
        return key;
    }
    private async wrapKeysForTeammates(key: Uint8Array, teammates: Teammate[]) {
        const machines = new Map<string, Uint8Array>();
        const members = [];
        for (const teammate of teammates) {
            let machineKey = machines.get(teammate.machineId);
            if (!machineKey) {
                machineKey = await this.getMachineKey(teammate.machineId);
                machines.set(teammate.machineId, machineKey);
            }
            members.push({ teammateId: teammate.id, encryptedDataKey: await wrapChannelKeyForTeammate(key, machineKey) });
        }
        return members;
    }
    create = async (kind: 'dm' | 'group', teammates: Teammate[], title: string | null = null, brief = '') => {
        const context = this.context();
        const key = generateChannelKey();
        const members = await this.wrapKeysForTeammates(key, teammates);
        const encryptedBrief = brief.trim() ? await encryptChannelBrief(key, brief.trim()) : null;
        context.assertValid();
        const channel = await api.createChannel(context.credentials, {
            kind, title, brief: encryptedBrief, userEncryptedDataKey: wrapChannelKeyForAccount(key, context.encryption.contentDataKey), teammates: members,
        });
        // DM creation is idempotent: always use the returned member key, never cache the candidate K.
        context.assertValid();
        storage.getState().applyChannels([channel]);
        return channel;
    };
    openDm = async (teammate: Teammate) => {
        const context = this.context();
        const channel = await api.fetchTeammateDm(context.credentials, teammate.id);
        context.assertValid();
        if (!channel) return this.create('dm', [teammate]);
        storage.getState().applyChannels([channel]);
        return channel;
    };
    applyMessages = async (channelId: string, messages: ChannelMessage[]) => {
        const context = this.context();
        if (!context.valid()) return;
        let channel = storage.getState().channels[channelId];
        if (!channel) {
            channel = await api.fetchChannel(context.credentials, channelId);
            if (!context.valid()) return;
            storage.getState().applyChannels([channel]);
        }
        const key = messages.some(m => m.content.t === 'encrypted') ? await this.key(channel, context.encryption).catch(() => null) : null;
        const cached = storage.getState().channelMessages[channelId] ?? [];
        const cachedBodies = new Map<string, StoredChannelMessage['body']>();
        for (const m of cached) {
            cachedBodies.set(m.id, m.body);
            if (m.localId) cachedBodies.set(`local:${m.localId}`, m.body);
        }
        const decrypted: StoredChannelMessage[] = [];
        for (const message of messages) {
            const previous = cachedBodies.get(message.id) ?? (message.localId ? cachedBodies.get(`local:${message.localId}`) : undefined);
            const body = previous ?? (message.content.t !== 'encrypted' ? undefined : key ? await decryptChannelMessage(key, message.content) : null);
            decrypted.push({ ...message, body });
        }
        // Messages are stored once opened, so a first visit never lists rows still waiting for the key.
        // An unopenable key still retains the ciphertext (body null) and advances unread state.
        if (context.valid()) storage.getState().applyChannelMessages(channelId, decrypted);
    };
    load = async (id: string) => {
        const context = this.context();
        const snapshot = storage.getState().channels;
        const channel = await api.fetchChannel(context.credentials, id);
        if (!context.valid()) return;
        storage.getState().applyChannels([channel], false, snapshot);
        // Always fetch the latest page: a socket message can arrive before focus and
        // its max seq alone is not proof that the intervening history is present.
        const latest = await api.fetchChannelMessages(context.credentials, id, { limit: 50 });
        if (!context.valid()) return;
        await this.applyMessages(id, latest);
        for (;;) {
            const confirmed = storage.getState().channelMessages[id]?.filter(m => !m.delivery) ?? [];
            const gap = confirmed.findIndex((m, index) => index > 0 && m.seq > confirmed[index - 1].seq + 1);
            if (gap < 0) break;
            const afterSeq = confirmed[gap - 1].seq;
            const beforeSeq = confirmed[gap].seq;
            const messages = await api.fetchChannelMessages(context.credentials, id, { afterSeq, beforeSeq, limit: 200 });
            if (!context.valid()) return;
            if (!messages.some(m => m.seq > afterSeq && m.seq < beforeSeq)) break;
            await this.applyMessages(id, messages);
        }
        // Runs show who is working; tasks give the task tags on messages their titles and status.
        await Promise.all(channel.members.filter(m => m.teammateId).map(async member => {
            const teammateId = member.teammateId!;
            const snapshot = storage.getState().teammateRuns[teammateId];
            const [runs, tasks] = await Promise.all([fetchTeammateRuns(context.credentials, teammateId), fetchTeammateTasks(context.credentials, teammateId)]);
            if (context.valid()) storage.getState().applyTeammateActivity(teammateId, { runs, tasks }, snapshot);
        }));
    };
    loadEarlier = async (id: string): Promise<boolean> => {
        const context = this.context();
        const confirmed = storage.getState().channelMessages[id]?.filter(m => !m.delivery) ?? [];
        const beforeSeq = confirmed.length ? Math.min(...confirmed.map(m => m.seq)) : undefined;
        const messages = await api.fetchChannelMessages(context.credentials, id, { beforeSeq, limit: 50 });
        if (!context.valid()) return false;
        await this.applyMessages(id, messages);
        return messages.length === 50;
    };
    send = async (id: string, body: ChannelMessageBody, mentions: string[], localId?: string, onOptimistic?: () => void, taskId?: string | null) => {
        const context = this.context();
        const channel = storage.getState().channels[id];
        if (!channel) throw new Error('Channel unavailable');
        const retry = localId ? storage.getState().channelMessages[id]?.find(m => m.localId === localId) : undefined;
        const request = {
            localId: localId ?? context.encryption.generateId(), kind: 'text' as const, mentions,
            taskId: retry ? retry.taskId : taskId ?? null,
            content: retry?.content.t === 'encrypted' ? retry.content : await encryptChannelMessage(await this.key(channel, context.encryption), body),
        };
        context.assertValid();
        const pending: StoredChannelMessage = {
            id: request.localId, channelId: id, seq: 0, localId: request.localId,
            senderType: 'user', senderId: channel.members.find(m => m.memberType === 'user')?.accountId ?? '',
            content: request.content, mentions, kind: 'text', taskId: request.taskId, runId: null,
            createdAt: retry?.createdAt ?? Date.now(), body, delivery: 'pending',
        };
        storage.getState().applyChannelMessages(id, [pending]);
        onOptimistic?.();
        try {
            const message = await api.sendChannelMessage(context.credentials, id, request);
            context.assertValid();
            storage.getState().applyChannelMessages(id, [{ ...message, body }]);
            return message;
        } catch (error) {
            if (context.valid()) {
                // A socket acknowledgement proves delivery even if the HTTP response was lost.
                const confirmed = storage.getState().channelMessages[id]?.find(m => m.localId === request.localId && !m.delivery);
                if (confirmed) return confirmed;
                storage.getState().applyChannelMessages(id, [{ ...pending, delivery: 'failed' }]);
            }
            throw error;
        }
    };
    markRead = async (id: string, seq: number) => {
        const context = this.context();
        await api.markChannelRead(context.credentials, id, { seq });
        if (context.valid()) storage.getState().markChannelReadLocal(id, seq);
    };
    reset = async (id: string) => {
        const context = this.context();
        await api.resetChannel(context.credentials, id);
        if (context.valid()) await this.load(id);
    };
    rename = async (id: string, title: string) => {
        const context = this.context();
        const channel = await api.updateChannel(context.credentials, id, { title });
        context.assertValid();
        storage.getState().applyChannels([channel]);
        return channel;
    };
    /** Replace a group's brief; blank text clears it. */
    setBrief = async (id: string, text: string) => {
        const context = this.context();
        const channel = storage.getState().channels[id];
        if (!channel) throw new Error('Channel unavailable');
        const brief = text.trim() ? await encryptChannelBrief(await this.key(channel, context.encryption), text.trim()) : null;
        context.assertValid();
        const updated = await api.updateChannel(context.credentials, id, { brief });
        context.assertValid();
        storage.getState().applyChannels([updated]);
        return updated;
    };
    /** Plain text of a group's brief; null when there is none or this account cannot open it. */
    readBrief = async (channel: Channel): Promise<string | null> => {
        if (!channel.brief) return null;
        const key = await this.key(channel, this.context().encryption).catch(() => null);
        return key ? decryptChannelBrief(key, channel.brief) : null;
    };
    addMembers = async (id: string, teammates: Teammate[]) => {
        const context = this.context();
        const channel = storage.getState().channels[id];
        if (!channel) throw new Error('Channel unavailable');
        const key = await this.key(channel, context.encryption);
        const members = await this.wrapKeysForTeammates(key, teammates);
        const updated = await api.addChannelMembers(context.credentials, id, { teammates: members });
        context.assertValid();
        storage.getState().applyChannels([updated]);
        return updated;
    };
    removeMember = async (id: string, teammateId: string) => {
        const context = this.context();
        const channel = await api.removeChannelMember(context.credentials, id, teammateId);
        context.assertValid();
        storage.getState().applyChannels([channel]);
        return channel;
    };
    delete = async (id: string) => {
        const context = this.context();
        await api.deleteChannel(context.credentials, id);
        context.assertValid();
        storage.getState().removeChannel(id);
    };
    rewrapMember = async (teammate: Teammate) => {
        const context = this.context();
        // Fetch the complete list: profile/list caches need not contain every group.
        const channels = await api.fetchChannels(context.credentials);
        context.assertValid();
        const machineKey = await this.getMachineKey(teammate.machineId);
        for (const channel of channels.filter(c => c.members.some(m => m.teammateId === teammate.id))) {
            const encryptedDataKey = await wrapChannelKeyForTeammate(await this.key(channel, context.encryption), machineKey);
            context.assertValid();
            await api.updateChannelMemberKey(context.credentials, channel.id, teammate.id, { encryptedDataKey });
            context.assertValid();
            // Refresh canonical state so local members keep the new wrapped key.
            const updated = await api.fetchChannel(context.credentials, channel.id);
            if (context.valid()) storage.getState().applyChannels([updated]);
        }
    };
}

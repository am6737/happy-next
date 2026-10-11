import type { Channel, ChannelMessage, ChannelMessageBody, Teammate } from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { Encryption } from './encryption/encryption';
import { storage } from './storage';
import { getServerUrl } from './serverConfig';
import * as api from './apiChannels';
import { decryptChannelMessage, encryptChannelMessage, generateChannelKey, unwrapChannelKey, wrapChannelKeyForAccount, wrapChannelKeyForTeammate } from './channelEncryption';
import { fetchTeammateRuns, fetchTeammateTasks } from './apiTeammates';
import { mergeTeammateRunSnapshot } from './teammateRuns';
import type { StoredChannelMessage } from './channelReducers';

/** Account/server guards also cover decryption awaits and late HTTP responses. */
export class ChannelSync {
    constructor(private readonly getContext: () => { credentials: AuthCredentials; encryption: Encryption },
        readonly getMachineKey: (id: string) => Promise<Uint8Array>) {}
    private visible = new Set<string>();
    watch(id: string) { this.visible.add(id); return () => { this.visible.delete(id); }; }
    private context() {
        const { credentials, encryption } = this.getContext();
        const server = getServerUrl();
        return { credentials, encryption, valid: () => {
            const current = this.getContext();
            return credentials === current.credentials && encryption === current.encryption && server === getServerUrl();
        } };
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
        return unwrapChannelKey(encryption, member.encryptedDataKey);
    }
    create = async (kind: 'dm' | 'group', teammates: Teammate[], title: string | null = null) => {
        const context = this.context();
        const key = generateChannelKey();
        // Reuse a machine key for Agents bound to the same machine.
        const machines = new Map<string, Uint8Array>();
        const members = [];
        for (const teammate of teammates) {
            let machineKey = machines.get(teammate.machineId);
            if (!machineKey) { machineKey = await this.getMachineKey(teammate.machineId); machines.set(teammate.machineId, machineKey); }
            members.push({ teammateId: teammate.id, encryptedDataKey: await wrapChannelKeyForTeammate(key, machineKey) });
        }
        if (!context.valid()) throw new Error('Account changed');
        const channel = await api.createChannel(context.credentials, {
            kind, title, userEncryptedDataKey: wrapChannelKeyForAccount(key, context.encryption.contentDataKey), teammates: members,
        });
        // DM creation is idempotent: always use the returned member key, never cache the candidate K.
        if (!context.valid()) throw new Error('Account changed');
        storage.getState().applyChannels([channel]);
        return channel;
    };
    openDm = async (teammate: Teammate) => {
        const context = this.context();
        const channel = await api.fetchTeammateDm(context.credentials, teammate.id);
        if (!context.valid()) throw new Error('Account changed');
        if (!channel) return this.create('dm', [teammate]);
        storage.getState().applyChannels([channel]);
        return channel;
    };
    applyMessages = async (channelId: string, messages: ChannelMessage[]) => {
        const context = this.context();
        if (!context.valid()) return;
        // Retain ciphertext and advance unread state even if a member key cannot be opened.
        storage.getState().applyChannelMessages(channelId, messages);
        let channel = storage.getState().channels[channelId];
        if (!channel) {
            channel = await api.fetchChannel(context.credentials, channelId);
            if (!context.valid()) return;
            storage.getState().applyChannels([channel]);
        }
        const key = messages.some(m => m.content.t === 'encrypted') ? await this.key(channel, context.encryption).catch(() => null) : null;
        const cached = storage.getState().channelMessages[channelId] ?? [];
        const decrypted: StoredChannelMessage[] = [];
        for (const message of messages) {
            const previous = cached.find(m => m.id === message.id || (!!message.localId && m.localId === message.localId));
            const body = previous?.body ?? (message.content.t === 'encrypted' && key ? await decryptChannelMessage(key, message.content) : message.content.t === 'encrypted' ? null : undefined);
            decrypted.push({ ...message, body });
        }
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
            if (!context.valid()) return;
            storage.setState(state => ({ teammateRuns: { ...state.teammateRuns,
                [teammateId]: mergeTeammateRunSnapshot(state.teammateRuns[teammateId], runs, snapshot) } }));
            storage.getState().applyTeammateTaskList(tasks);
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
        if (!context.valid()) throw new Error('Account changed');
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
            if (!context.valid()) throw new Error('Account changed');
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
    rewrapMember = async (teammate: Teammate) => {
        const context = this.context();
        // Fetch the complete list: profile/list caches need not contain every group.
        const channels = await api.fetchChannels(context.credentials);
        if (!context.valid()) throw new Error('Account changed');
        const machineKey = await this.getMachineKey(teammate.machineId);
        for (const channel of channels.filter(c => c.members.some(m => m.teammateId === teammate.id))) {
            const encryptedDataKey = await wrapChannelKeyForTeammate(await this.key(channel, context.encryption), machineKey);
            if (!context.valid()) throw new Error('Account changed');
            await api.updateChannelMemberKey(context.credentials, channel.id, teammate.id, { encryptedDataKey });
            if (!context.valid()) throw new Error('Account changed');
            // Refresh canonical state so local members keep the new wrapped key.
            const updated = await api.fetchChannel(context.credentials, channel.id);
            if (context.valid()) storage.getState().applyChannels([updated]);
        }
    };
}

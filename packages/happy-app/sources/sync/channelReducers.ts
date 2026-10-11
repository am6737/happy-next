import type { Channel, ChannelMessage, ChannelMessageBody } from 'happy-wire';

export type StoredChannelMessage = ChannelMessage & {
    body?: ChannelMessageBody | null;
    delivery?: 'pending' | 'failed';
};
export const emptyChannelState = { channels: {} as Record<string, Channel>, channelsLoaded: false, channelMessages: {} as Record<string, StoredChannelMessage[]> };
export function mergeChannels(current: Record<string, Channel>, incoming: Channel[], atRequest?: Record<string, Channel>): Record<string, Channel> {
    const next = { ...current };
    for (const channel of incoming) {
        const previous = current[channel.id];
        // Keep socket updates received during a REST fetch, including key-only updates.
        const changedDuringRequest = !!atRequest && !!previous && previous !== atRequest[channel.id];
        if (!previous) { next[channel.id] = channel; continue; }
        const newest = !changedDuringRequest && channel.seq >= previous.seq ? channel : previous;
        next[channel.id] = {
            ...newest, seq: Math.max(previous.seq, channel.seq), lastMessageAt: Math.max(previous.lastMessageAt, channel.lastMessageAt),
            members: newest.members.map(member => {
                const old = previous.members.find(m => m.memberType === member.memberType && m.accountId === member.accountId && m.teammateId === member.teammateId);
                const other = channel.members.find(m => m.memberType === member.memberType && m.accountId === member.accountId && m.teammateId === member.teammateId);
                return { ...member, lastReadSeq: Math.max(member.lastReadSeq, old?.lastReadSeq ?? 0, other?.lastReadSeq ?? 0) };
            }),
        };
    }
    return next;
}
export function mergeChannelMessages(current: StoredChannelMessage[] = [], incoming: StoredChannelMessage[]): StoredChannelMessage[] {
    // A message matches by id, or by localId when an optimistic copy is confirmed.
    const byId = new Map(current.map(m => [m.id, m]));
    const byLocalId = new Map(current.flatMap(m => m.localId ? [[m.localId, m] as const] : []));
    for (const message of incoming) {
        const matches = [byId.get(message.id), message.localId ? byLocalId.get(message.localId) : undefined]
            .filter((m, index, all): m is StoredChannelMessage => !!m && all.indexOf(m) === index);
        for (const m of matches) {
            byId.delete(m.id);
            if (m.localId && byLocalId.get(m.localId) === m) byLocalId.delete(m.localId);
        }
        const confirmed = matches.find(m => !m.delivery);
        const base = message.delivery && confirmed ? confirmed : message;
        const cached = matches.find(m => m.body !== undefined);
        const merged = { ...base, body: base.body === undefined ? cached?.body ?? message.body : base.body };
        byId.set(merged.id, merged);
        if (merged.localId) byLocalId.set(merged.localId, merged);
    }
    return [...byId.values()].sort((a, b) => {
        if (!!a.delivery !== !!b.delivery) return a.delivery ? 1 : -1;
        return a.delivery ? a.createdAt - b.createdAt : a.seq - b.seq;
    });
}
export function channelUnread(channel: Channel, accountId: string): number {
    const member = channel.members.find(m => m.memberType === 'user' && m.accountId === accountId);
    return Math.max(0, channel.seq - (member?.lastReadSeq ?? 0));
}

export function reduceChannelMessages(state: Pick<typeof emptyChannelState, 'channels' | 'channelMessages'>, id: string, messages: StoredChannelMessage[]) {
    const channel = state.channels[id];
    const confirmed = messages.filter(m => !m.delivery);
    const seq = Math.max(channel?.seq ?? 0, ...confirmed.map(m => m.seq));
    const lastMessageAt = Math.max(channel?.lastMessageAt ?? 0, ...confirmed.map(m => m.createdAt));
    return {
        channelMessages: { ...state.channelMessages, [id]: mergeChannelMessages(state.channelMessages[id], messages) },
        ...(channel ? { channels: { ...state.channels, [id]: { ...channel, seq, lastMessageAt } } } : {}),
    };
}
export function reduceChannelRead(channels: Record<string, Channel>, id: string, seq: number): Record<string, Channel> {
    const channel = channels[id];
    if (!channel) return channels;
    return { ...channels, [id]: { ...channel, members: channel.members.map(member =>
        member.memberType === 'user' ? { ...member, lastReadSeq: Math.max(member.lastReadSeq, seq) } : member) } };
}

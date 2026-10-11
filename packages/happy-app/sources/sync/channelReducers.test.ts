import { describe, expect, it } from 'vitest';
import { channelUnread, mergeChannels, mergeChannelMessages, reduceChannelMessages, reduceChannelRead, type StoredChannelMessage } from './channelReducers';
import { testChannel as channel, testChannelMessage as message } from './channelTestFixtures';
import { channelDecisionSelections, channelMentions } from './channelDecisions';
const pending: StoredChannelMessage = { ...message, id: 'local', seq: 0, body: { text: 'hello' }, delivery: 'pending' };

describe('channel storage reducers', () => {
    it('orders confirmed messages by seq and pending messages last', () => {
        const earlier = { ...message, id: 'earlier', localId: null, seq: 1 };
        expect(mergeChannelMessages([], [pending, { ...message, localId: 'other', id: 'other' }, earlier]).map(m => m.id)).toEqual(['earlier', 'other', 'local']);
    });
    it('reconciles optimistic sends with HTTP/socket in either order and retains the decrypted body', () => {
        let messages = mergeChannelMessages([], [pending]);
        messages = mergeChannelMessages(messages, [message, message]);
        expect(messages).toEqual([{ ...message, body: { text: 'hello' } }]);
        expect(mergeChannelMessages(messages, [{ ...pending, delivery: 'failed' }])).toEqual(messages);
        expect(mergeChannelMessages([message], [pending])).toEqual([{ ...message, body: pending.body }]);
    });
    it('dedupes by id even when localId is absent and removes both matching id/localId rows', () => {
        expect(mergeChannelMessages([{ ...message, localId: null }], [message])).toHaveLength(1);
        expect(mergeChannelMessages([pending, { ...message, localId: null }], [message])).toHaveLength(1);
    });
    it('allows failed sends to retry with the same localId', () => {
        let messages = mergeChannelMessages([], [{ ...pending, delivery: 'failed' }]);
        messages = mergeChannelMessages(messages, [pending]);
        expect(messages[0].delivery).toBe('pending');
        expect(mergeChannelMessages(messages, [message])[0].delivery).toBeUndefined();
    });
    it('advances channel seq/unread on confirmed updates, never on pending messages or older history', () => {
        const state = { channels: { [channel.id]: channel }, channelMessages: {} };
        const optimistic = reduceChannelMessages(state, channel.id, [pending]);
        expect(optimistic.channels?.[channel.id].seq).toBe(2);
        const received = reduceChannelMessages(state, channel.id, [{ ...message, seq: 10, createdAt: 100 }]);
        expect(channelUnread(received.channels![channel.id], 'owner')).toBe(10);
        const history = reduceChannelMessages({ ...state, ...received }, channel.id, [{ ...message, id: 'old', seq: 1, createdAt: 1 }]);
        expect(history.channels?.[channel.id].seq).toBe(10);
        expect(history.channels?.[channel.id].lastMessageAt).toBe(100);
    });
    it('keeps seq and read cursors monotonic across stale channel snapshots', () => {
        const read = reduceChannelRead({ [channel.id]: channel }, channel.id, 2);
        const updated = mergeChannels(read, [{ ...channel, seq: 1, lastMessageAt: 1 }]);
        expect(updated[channel.id].seq).toBe(2);
        expect(channelUnread(updated[channel.id], 'owner')).toBe(0);
        expect(reduceChannelRead(updated, channel.id, 1)[channel.id].members[0].lastReadSeq).toBe(2);
        expect(reduceChannelRead(updated, 'absent', 1)).toBe(updated);
    });
    it('preserves key-only socket updates received during a REST refresh', () => {
        const baseline = { [channel.id]: channel };
        const changed = { ...channel, members: channel.members.map(m => ({ ...m, encryptedDataKey: 'new' })) };
        expect(mergeChannels({ [channel.id]: changed }, [channel], baseline)[channel.id]).toEqual(changed);
        expect(mergeChannels(baseline, [changed], baseline)[channel.id].members[0].encryptedDataKey).toBe('new');
    });
});
describe('channel decisions and mentions', () => {
    it('associates each text choice with the latest matching unanswered decision', () => {
        const decision = { ...message, id: 'd1', localId: null, kind: 'decision' as const, senderType: 'teammate' as const, body: { text: 'Pick', options: [{ id: 'yes', label: 'Go' }] } };
        const newer = { ...decision, id: 'd2' };
        const reply = { ...message, body: { text: 'Go' } };
        expect(channelDecisionSelections([decision, newer, reply])).toEqual({ d2: 'yes' });
        expect(channelDecisionSelections([decision, newer, { ...reply, delivery: 'failed' }])).toEqual({});
        expect(channelDecisionSelections([decision, { ...reply, delivery: 'pending' }])).toEqual({ d1: 'yes' });
    });
    it('includes only complete member handles and ignores emails, prefixes and duplicates', () => {
        const members = [{ id: 'a', handle: 'atlas' }, { id: 'b', handle: 'atlas-dev' }];
        expect(channelMentions('@atlas, (@atlas-dev) @atlas @outsider email@atlas @atlas-extra @atlas中文', members)).toEqual(['a','b']);
        expect(channelMentions('@atlas-dev', members)).toEqual(['b']);
    });
});

import { ChannelSchema, ChannelMessageSchema } from 'happy-wire';

export const testChannel = ChannelSchema.parse({ id: 'chat/with space', kind: 'group', title: 'Team', seq: 2, lastMessageAt: 20, createdAt: 0,
    members: [{ memberType: 'user', accountId: 'owner', teammateId: null, encryptedDataKey: 'user-key', lastReadSeq: 0 },
        { memberType: 'teammate', accountId: null, teammateId: 'agent/1', encryptedDataKey: 'agent-key', lastReadSeq: 0 }] });
export const testChannelMessage = ChannelMessageSchema.parse({ id: 'message', channelId: testChannel.id, seq: 2, localId: 'local',
    senderType: 'user', senderId: 'owner', content: { t: 'encrypted', c: 'ciphertext' }, mentions: ['agent/1'], kind: 'text', taskId: null, runId: null, createdAt: 20 });

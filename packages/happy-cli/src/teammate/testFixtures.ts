import type { Teammate, TeammateRunDispatchPayload, ChannelMessage } from 'happy-wire';
import { encodeBase64, encryptWithDataKey } from '@/api/encryption';
import { encryptChannelMessage } from './channelCrypto';

export function makeTeammate(overrides: Partial<Teammate> = {}): Teammate {
    return {
        id: 'teammate-atlas',
        handle: 'atlas',
        name: 'Atlas',
        avatar: null,
        role: 'Backend engineer',
        skills: ['typescript', 'testing'],
        repos: ['owner/repo'],
        instructions: 'Be concise and verify your work.',
        machineId: 'machine-1',
        controllerProvider: 'claude',
        controllerModel: null,
        controllerPermissionMode: 'default',
        controllerProfileId: null,
        controllerEnv: null,
        workerProvider: 'claude',
        model: null,
        workerPermissionMode: 'default',
        workerProfileId: null,
        workerEnv: null,
        maxConcurrentRuns: 3,
        monthlyBudgetUsd: null,
        heartbeatIntervalMin: null,
        activeHours: null,
        timezone: null,
        dreamingHour: null,
        canSelfAssign: false,
        contextBudgetTokens: null,
        contextAutoRollover: true,
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

export const channelTestKey = new Uint8Array(32).fill(31);
export const machineTestKey = new Uint8Array(32).fill(17);

export function makeConversationPayload(kind: 'dm' | 'group' = 'dm'): TeammateRunDispatchPayload {
    return {
        runId: 'run-chat', dispatchToken: 'dispatch-chat', attempt: 1, teammate: makeTeammate(),
        thread: { id: 'thread-chat', kind, channelId: 'channel-1', taskId: null, providerSessionId: null, currentSessionId: null, resetAt: null },
        channel: {
            id: 'channel-1', kind, title: kind === 'group' ? 'Engineering' : null, brief: null,
            teammateEncryptedDataKey: encodeBase64(encryptWithDataKey({ k: encodeBase64(channelTestKey) }, machineTestKey)),
            members: [
                { memberType: 'user', id: 'owner', name: 'Alex', handle: null },
                { memberType: 'teammate', id: 'teammate-atlas', name: 'Atlas', handle: 'atlas' },
                { memberType: 'teammate', id: 'teammate-nova', name: 'Nova', handle: 'nova' },
            ],
        },
        task: null,
        trigger: 'channel-message',
        events: [{ type: 'channel-message', at: 1, data: { channelId: 'channel-1', messageId: 'message-12', seq: 12 } }],
    };
}

export function makeChannelMessage(seq = 12, text = '@atlas Review this'): ChannelMessage {
    return {
        id: `message-${seq}`, channelId: 'channel-1', seq, localId: null, senderType: 'user', senderId: 'owner',
        content: { t: 'encrypted', c: encryptChannelMessage({ text }, channelTestKey) },
        mentions: ['teammate-atlas'], kind: 'text', taskId: null, runId: null, createdAt: Date.UTC(2026, 9, 9, 10, 31),
    };
}

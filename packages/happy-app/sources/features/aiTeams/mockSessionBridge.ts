import { storage } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';
import type { AiMockExecutionSession, AiMockSessionMessage } from './mockData';

function providerFlavor(provider: AiMockExecutionSession['provider']): string {
    if (provider === 'Codex') return 'codex';
    if (provider === 'Gemini') return 'gemini';
    return 'claude';
}

function messageTimestamp(index: number, total: number): number {
    return Date.now() - (total - index) * 60_000;
}

function normalizeMessage(message: AiMockSessionMessage, index: number, total: number): NormalizedMessage {
    const createdAt = messageTimestamp(index, total);
    if (message.role === 'user') {
        return {
            id: message.id,
            localId: null,
            createdAt,
            seq: index + 1,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text: message.text },
        };
    }
    if (message.role === 'tool') {
        const toolId = `tool-${message.id}`;
        return {
            id: message.id,
            localId: null,
            createdAt,
            seq: index + 1,
            role: 'agent',
            isSidechain: false,
            content: [
                {
                    type: 'tool-call',
                    id: toolId,
                    name: message.title || 'Task',
                    input: {},
                    description: message.text,
                    uuid: `${message.id}-call`,
                    parentUUID: null,
                },
                {
                    type: 'tool-result',
                    tool_use_id: toolId,
                    content: message.text,
                    is_error: false,
                    uuid: `${message.id}-result`,
                    parentUUID: null,
                },
            ],
        };
    }
    return {
        id: message.id,
        localId: null,
        createdAt,
        seq: index + 1,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: message.text, uuid: `${message.id}-text`, parentUUID: null }],
    };
}

export function ensureMockSessionLoaded(mock: AiMockExecutionSession) {
    const now = Date.now();
    const flavor = providerFlavor(mock.provider);
    const existing = storage.getState().sessions[mock.id];
    const session: Omit<Session, 'presence'> & { presence?: 'online' | number } = {
        id: mock.id,
        seq: existing?.seq ?? 1,
        createdAt: existing?.createdAt ?? now - mock.messages.length * 60_000,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: `/workspace/${mock.projectLabel}`,
            host: 'Happy Next Agent',
            name: mock.title,
            model: mock.provider,
            flavor,
            sessionIcon: flavor,
            summary: { text: mock.statusLabel, updatedAt: now },
            externalContext: {
                source: 'happy-next-ai-team',
                resourceType: 'execution',
                resourceId: mock.executionId,
                title: mock.title,
                deepLink: `/inbox/ai/executions/${mock.executionId}`,
            },
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now,
        presence: 'online',
        permissionMode: 'default',
        modelMode: 'default',
        accessLevel: 'admin',
    };

    storage.getState().applySessions([session]);
    if (!storage.getState().sessionMessages[mock.id]?.isLoaded) {
        const messages = mock.messages.map((message, index) => normalizeMessage(message, index, mock.messages.length));
        storage.getState().applyMessages(mock.id, messages);
        storage.getState().applyMessagesLoaded(mock.id);
        storage.getState().setSessionPagination(mock.id, 1, false);
    }
}

export function appendMockSessionExchange(sessionId: string, text: string, assistantReply: string) {
    const now = Date.now();
    const seed = `${now}`;
    const messages: NormalizedMessage[] = [
        {
            id: `mock-user-${seed}`,
            localId: null,
            createdAt: now,
            seq: now,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text },
        },
        {
            id: `mock-agent-${seed}`,
            localId: null,
            createdAt: now + 1,
            seq: now + 1,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: assistantReply, uuid: `mock-agent-${seed}-text`, parentUUID: null }],
        },
    ];
    storage.getState().applyMessages(sessionId, messages);
}

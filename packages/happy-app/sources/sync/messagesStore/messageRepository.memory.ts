import type { ApiMessage } from '../apiTypes';
import { mergeSessionState, toMessagePage } from './common';
import type { MessagePage, MessageRepository, SessionMessageCacheState, SessionMessageCacheStatePatch } from './types';

type MessageKey = `${string}\u0000${string}\u0000${string}`;
type StateKey = `${string}\u0000${string}`;
type PendingDeliveryIssueIdentityType = 'messageId' | 'localId';
type PendingDeliveryIssueKey = `${string}\u0000${string}\u0000${PendingDeliveryIssueIdentityType}\u0000${string}`;
type PendingDeliveryIssue = {
    issue: NonNullable<ApiMessage['deliveryIssue']>;
    updatedAt: number;
};

function messageKey(accountKey: string, sessionId: string, id: string): MessageKey {
    return `${accountKey}\u0000${sessionId}\u0000${id}`;
}

function stateKey(accountKey: string, sessionId: string): StateKey {
    return `${accountKey}\u0000${sessionId}`;
}

function pendingDeliveryIssueKey(accountKey: string, sessionId: string, identityType: PendingDeliveryIssueIdentityType, identityValue: string): PendingDeliveryIssueKey {
    return `${accountKey}\u0000${sessionId}\u0000${identityType}\u0000${identityValue}`;
}

function cloneMessage(message: ApiMessage): ApiMessage {
    return {
        ...message,
        localId: message.localId ?? null,
        sentBy: message.sentBy ?? null,
        sentByName: message.sentByName ?? null,
        updatedAt: message.updatedAt ?? message.createdAt,
        deliveryIssue: message.deliveryIssue ?? undefined,
        content: { ...message.content },
    };
}

export class InMemoryMessageRepository implements MessageRepository {
    private messages = new Map<MessageKey, ApiMessage>();
    private states = new Map<StateKey, SessionMessageCacheState>();
    private pendingDeliveryIssues = new Map<PendingDeliveryIssueKey, PendingDeliveryIssue>();

    async upsertMessages(accountKey: string, sessionId: string, messages: ApiMessage[]): Promise<void> {
        for (const input of messages) {
            const message = cloneMessage(input);
            this.applyPendingDeliveryIssue(accountKey, sessionId, message);
            for (const [key, value] of this.messages) {
                if (key.startsWith(`${accountKey}\u0000${sessionId}\u0000`) && value.seq === message.seq && value.id !== message.id) {
                    this.messages.delete(key);
                }
            }
            this.messages.set(messageKey(accountKey, sessionId, message.id), message);
        }
    }

    async upsertMessagesAndUpdateState(accountKey: string, sessionId: string, messages: ApiMessage[], patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        await this.upsertMessages(accountKey, sessionId, messages);
        return this.updateSessionState(accountKey, sessionId, patch);
    }

    async getLatestMessages(accountKey: string, sessionId: string, limit: number): Promise<MessagePage> {
        const sorted = this.getSessionMessages(accountKey, sessionId).sort((a, b) => b.seq - a.seq);
        const page = sorted.slice(0, limit);
        return toMessagePage(page.map(cloneMessage), sorted.length > limit);
    }

    async getMessagesAfter(accountKey: string, sessionId: string, afterSeq: number, limit: number): Promise<MessagePage> {
        const sorted = this.getSessionMessages(accountKey, sessionId)
            .filter((message) => message.seq > afterSeq)
            .sort((a, b) => a.seq - b.seq);
        const page = sorted.slice(0, limit);
        return toMessagePage(page.map(cloneMessage), sorted.length > limit);
    }

    async getMessagesBefore(accountKey: string, sessionId: string, beforeSeq: number, limit: number): Promise<MessagePage> {
        const sorted = this.getSessionMessages(accountKey, sessionId)
            .filter((message) => message.seq < beforeSeq)
            .sort((a, b) => b.seq - a.seq);
        const page = sorted.slice(0, limit);
        return toMessagePage(page.map(cloneMessage), sorted.length > limit);
    }

    async getSessionState(accountKey: string, sessionId: string): Promise<SessionMessageCacheState | null> {
        const state = this.states.get(stateKey(accountKey, sessionId));
        return state ? { ...state } : null;
    }

    async updateSessionState(accountKey: string, sessionId: string, patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        const key = stateKey(accountKey, sessionId);
        const state = mergeSessionState(this.states.get(key) ?? null, patch);
        this.states.set(key, state);
        return { ...state };
    }

    async clearSession(accountKey: string, sessionId: string): Promise<void> {
        for (const key of [...this.messages.keys()]) {
            if (key.startsWith(`${accountKey}\u0000${sessionId}\u0000`)) {
                this.messages.delete(key);
            }
        }
        for (const key of [...this.pendingDeliveryIssues.keys()]) {
            if (key.startsWith(`${accountKey}\u0000${sessionId}\u0000`)) {
                this.pendingDeliveryIssues.delete(key);
            }
        }
        this.states.delete(stateKey(accountKey, sessionId));
    }

    async deleteSessions(accountKey: string, sessionIds: string[]): Promise<void> {
        await Promise.all(sessionIds.map((sessionId) => this.clearSession(accountKey, sessionId)));
    }

    async updateDeliveryIssue(accountKey: string, sessionId: string, identity: { messageId?: string; localId?: string | null }, issue: ApiMessage['deliveryIssue'] | null | undefined): Promise<void> {
        let found = false;
        for (const [key, message] of this.messages) {
            if (!key.startsWith(`${accountKey}\u0000${sessionId}\u0000`)) continue;
            if ((identity.messageId && message.id === identity.messageId) || (identity.localId && message.localId === identity.localId)) {
                found = true;
                this.messages.set(key, cloneMessage({ ...message, deliveryIssue: issue ?? undefined, updatedAt: Date.now() }));
            }
        }

        const identities = this.deliveryIssueIdentities(identity);
        if (found || !issue) {
            for (const pending of identities) {
                this.pendingDeliveryIssues.delete(pendingDeliveryIssueKey(accountKey, sessionId, pending.type, pending.value));
            }
            return;
        }

        const updatedAt = Date.now();
        for (const pending of identities) {
            this.pendingDeliveryIssues.set(
                pendingDeliveryIssueKey(accountKey, sessionId, pending.type, pending.value),
                { issue, updatedAt },
            );
        }
    }

    async clearAccount(accountKey: string): Promise<void> {
        for (const key of [...this.messages.keys()]) {
            if (key.startsWith(`${accountKey}\u0000`)) this.messages.delete(key);
        }
        for (const key of [...this.states.keys()]) {
            if (key.startsWith(`${accountKey}\u0000`)) this.states.delete(key);
        }
        for (const key of [...this.pendingDeliveryIssues.keys()]) {
            if (key.startsWith(`${accountKey}\u0000`)) this.pendingDeliveryIssues.delete(key);
        }
    }

    async clearAll(): Promise<void> {
        this.messages.clear();
        this.states.clear();
        this.pendingDeliveryIssues.clear();
    }

    private getSessionMessages(accountKey: string, sessionId: string): ApiMessage[] {
        return [...this.messages.entries()]
            .filter(([key]) => key.startsWith(`${accountKey}\u0000${sessionId}\u0000`))
            .map(([, value]) => value);
    }

    private deliveryIssueIdentities(identity: { messageId?: string; localId?: string | null }): Array<{ type: PendingDeliveryIssueIdentityType; value: string }> {
        const identities: Array<{ type: PendingDeliveryIssueIdentityType; value: string }> = [];
        if (identity.messageId) {
            identities.push({ type: 'messageId', value: identity.messageId });
        }
        if (identity.localId) {
            identities.push({ type: 'localId', value: identity.localId });
        }
        return identities;
    }

    private applyPendingDeliveryIssue(accountKey: string, sessionId: string, message: ApiMessage): void {
        const identities = this.deliveryIssueIdentities({ messageId: message.id, localId: message.localId });
        let latest: PendingDeliveryIssue | null = null;
        for (const identity of identities) {
            const pending = this.pendingDeliveryIssues.get(pendingDeliveryIssueKey(accountKey, sessionId, identity.type, identity.value));
            if (!pending) continue;
            if (!latest || pending.updatedAt >= latest.updatedAt) {
                latest = pending;
            }
        }
        if (latest) {
            message.deliveryIssue = latest.issue;
            message.updatedAt = Math.max(message.updatedAt ?? message.createdAt, latest.updatedAt);
        }
        for (const identity of identities) {
            this.pendingDeliveryIssues.delete(pendingDeliveryIssueKey(accountKey, sessionId, identity.type, identity.value));
        }
    }
}

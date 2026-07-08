import type { ApiMessage } from '../apiTypes';

export type MessageCacheAccountKey = string;

export interface MessagePage {
    messages: ApiMessage[];
    minSeq: number | null;
    maxSeq: number | null;
    hasMoreLocal: boolean;
}

export interface SessionMessageCacheState {
    forwardMaxSeq: number;
    oldestLoadedSeq: number | null;
    hasMoreOlder: boolean;
    contiguousMinSeq: number | null;
    contiguousMaxSeq: number | null;
    remoteOldestSeq: number | null;
    invalidatedAt: number | null;
    updatedAt: number;
}

export interface SessionMessageCacheStatePatch {
    forwardMaxSeq?: number;
    oldestLoadedSeq?: number | null;
    hasMoreOlder?: boolean;
    contiguousMinSeq?: number | null;
    contiguousMaxSeq?: number | null;
    remoteOldestSeq?: number | null;
    invalidatedAt?: number | null;
}

export interface MessageRepository {
    upsertMessages(accountKey: MessageCacheAccountKey, sessionId: string, messages: ApiMessage[]): Promise<void>;
    upsertMessagesAndUpdateState(accountKey: MessageCacheAccountKey, sessionId: string, messages: ApiMessage[], patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState>;
    getLatestMessages(accountKey: MessageCacheAccountKey, sessionId: string, limit: number): Promise<MessagePage>;
    getMessagesAfter(accountKey: MessageCacheAccountKey, sessionId: string, afterSeq: number, limit: number): Promise<MessagePage>;
    getMessagesBefore(accountKey: MessageCacheAccountKey, sessionId: string, beforeSeq: number, limit: number): Promise<MessagePage>;
    getSessionState(accountKey: MessageCacheAccountKey, sessionId: string): Promise<SessionMessageCacheState | null>;
    updateSessionState(accountKey: MessageCacheAccountKey, sessionId: string, patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState>;
    clearSession(accountKey: MessageCacheAccountKey, sessionId: string): Promise<void>;
    deleteSessions(accountKey: MessageCacheAccountKey, sessionIds: string[]): Promise<void>;
    updateDeliveryIssue(accountKey: MessageCacheAccountKey, sessionId: string, identity: { messageId?: string; localId?: string | null }, issue: ApiMessage['deliveryIssue'] | null | undefined): Promise<void>;
    clearAccount(accountKey: MessageCacheAccountKey): Promise<void>;
    clearAll(): Promise<void>;
}

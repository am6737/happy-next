import type { ApiMessage } from '../apiTypes';

export type MessageCacheAccountKey = string;

export interface MessagePage {
    messages: ApiMessage[];
    minSeq: number | null;
    maxSeq: number | null;
    hasMoreLocal: boolean;
}

/**
 * Index-only page of the local message cache: the ids and seqs of a page of messages, without the
 * ciphertext column. The ciphertext is the bulk of a cached row (~7 KB per message on a real
 * session) and is only needed for messages whose content has not been decrypted yet in this app
 * run, so read-only consumers (the minimap scan, the search index) page over the index instead.
 */
export interface MessageIndexRow {
    id: string;
    seq: number;
}

export interface MessageIndexPage {
    rows: MessageIndexRow[];
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
    // Index-only reads of the same pages: the ids and seqs without the ciphertext column, which is
    // the bulk of a cached row and is only needed for messages that have not been decrypted yet in
    // this app run. `getMessagesByIds` fetches those full rows, in the order the ids were given.
    getLatestMessageIndexes(accountKey: MessageCacheAccountKey, sessionId: string, limit: number): Promise<MessageIndexPage>;
    getMessageIndexesBefore(accountKey: MessageCacheAccountKey, sessionId: string, beforeSeq: number, limit: number): Promise<MessageIndexPage>;
    getMessagesByIds(accountKey: MessageCacheAccountKey, sessionId: string, ids: readonly string[]): Promise<ApiMessage[]>;
    getSessionState(accountKey: MessageCacheAccountKey, sessionId: string): Promise<SessionMessageCacheState | null>;
    updateSessionState(accountKey: MessageCacheAccountKey, sessionId: string, patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState>;
    clearSession(accountKey: MessageCacheAccountKey, sessionId: string): Promise<void>;
    deleteSessions(accountKey: MessageCacheAccountKey, sessionIds: string[]): Promise<void>;
    updateDeliveryIssue(accountKey: MessageCacheAccountKey, sessionId: string, identity: { messageId?: string; localId?: string | null }, issue: ApiMessage['deliveryIssue'] | null | undefined): Promise<void>;
    clearAccount(accountKey: MessageCacheAccountKey): Promise<void>;
    clearAll(): Promise<void>;
}

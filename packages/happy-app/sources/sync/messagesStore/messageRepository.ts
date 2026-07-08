import type { ApiMessage } from '../apiTypes';
import { mergeSessionState, toMessagePage } from './common';
import type { MessagePage, MessageRepository, SessionMessageCacheState, SessionMessageCacheStatePatch } from './types';

const DB_NAME = 'happy-message-cache-v1';
const DB_VERSION = 4;
const MESSAGES_STORE = 'messages';
const STATES_STORE = 'sessionStates';
const PENDING_DELIVERY_ISSUES_STORE = 'pendingDeliveryIssues';
const INDEX_SESSION_SEQ = 'bySessionSeq';
const INDEX_SESSION_LOCAL_ID = 'bySessionLocalId';
const INDEX_PENDING_DELIVERY_SESSION = 'byPendingDeliverySession';

const MIN_SEQ_KEY = Number.MIN_SAFE_INTEGER;
const MAX_SEQ_KEY = Number.MAX_SAFE_INTEGER;

type StoredMessage = {
    accountKey: string;
    sessionId: string;
    id: string;
    seq: number;
    localId: string | null;
    contentCiphertext: string;
    sentBy: string | null;
    sentByName: string | null;
    deliveryStatus: 'waiting' | 'error' | null;
    deliveryReason: string | null;
    createdAt: number;
    updatedAt: number;
    storedAt: number;
};

type StoredState = {
    accountKey: string;
    sessionId: string;
    forwardMaxSeq: number;
    oldestLoadedSeq: number | null;
    hasMoreOlder: boolean;
    contiguousMinSeq?: number | null;
    contiguousMaxSeq?: number | null;
    remoteOldestSeq?: number | null;
    invalidatedAt: number | null;
    updatedAt: number;
};

type PendingDeliveryIssueIdentityType = 'messageId' | 'localId';

type StoredPendingDeliveryIssue = {
    accountKey: string;
    sessionId: string;
    identityType: PendingDeliveryIssueIdentityType;
    identityValue: string;
    deliveryStatus: 'waiting' | 'error';
    deliveryReason: string | null;
    updatedAt: number;
};

function normalizeMessage(message: ApiMessage): ApiMessage {
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

function toStoredMessage(accountKey: string, sessionId: string, message: ApiMessage, now: number): StoredMessage {
    const normalized = normalizeMessage(message);
    return {
        accountKey,
        sessionId,
        id: normalized.id,
        seq: normalized.seq,
        localId: normalized.localId ?? null,
        contentCiphertext: normalized.content.c,
        sentBy: normalized.sentBy ?? null,
        sentByName: normalized.sentByName ?? null,
        deliveryStatus: normalized.deliveryIssue?.status ?? null,
        deliveryReason: normalized.deliveryIssue?.reason ?? null,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt ?? normalized.createdAt,
        storedAt: now,
    };
}

function toApiMessage(message: StoredMessage): ApiMessage {
    return {
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        content: { t: 'encrypted', c: message.contentCiphertext },
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        sentBy: message.sentBy,
        sentByName: message.sentByName,
        deliveryIssue: message.deliveryStatus
            ? { status: message.deliveryStatus, reason: message.deliveryReason }
            : undefined,
    };
}

function storedStateToState(state: StoredState): SessionMessageCacheState {
    return {
        forwardMaxSeq: state.forwardMaxSeq,
        oldestLoadedSeq: state.oldestLoadedSeq,
        hasMoreOlder: state.hasMoreOlder,
        contiguousMinSeq: state.contiguousMinSeq ?? null,
        contiguousMaxSeq: state.contiguousMaxSeq ?? null,
        remoteOldestSeq: state.remoteOldestSeq ?? null,
        invalidatedAt: state.invalidatedAt,
        updatedAt: state.updatedAt,
    };
}

function stateToStoredState(accountKey: string, sessionId: string, state: SessionMessageCacheState): StoredState {
    return { accountKey, sessionId, ...state };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
}

function sessionSeqRange(accountKey: string, sessionId: string, lower: number, upper: number, lowerOpen = false, upperOpen = false): IDBKeyRange {
    return IDBKeyRange.bound([accountKey, sessionId, lower], [accountKey, sessionId, upper], lowerOpen, upperOpen);
}

function deliveryIssueIdentities(identity: { messageId?: string; localId?: string | null }): Array<{ type: PendingDeliveryIssueIdentityType; value: string }> {
    const identities: Array<{ type: PendingDeliveryIssueIdentityType; value: string }> = [];
    if (identity.messageId) {
        identities.push({ type: 'messageId', value: identity.messageId });
    }
    if (identity.localId) {
        identities.push({ type: 'localId', value: identity.localId });
    }
    return identities;
}

function pendingDeliveryIssueKey(accountKey: string, sessionId: string, identityType: PendingDeliveryIssueIdentityType, identityValue: string): [string, string, PendingDeliveryIssueIdentityType, string] {
    return [accountKey, sessionId, identityType, identityValue];
}

async function collectCursor<T>(request: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<{ items: T[]; hasMore: boolean }> {
    return new Promise((resolve, reject) => {
        const items: T[] = [];
        let hasMore = false;
        request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve({ items, hasMore });
                return;
            }
            if (items.length >= limit) {
                hasMore = true;
                resolve({ items, hasMore });
                return;
            }
            items.push(cursor.value as T);
            cursor.continue();
        };
    });
}

class IndexedDBMessageRepository implements MessageRepository {
    private dbPromise: Promise<IDBDatabase> | null = null;
    private writeQueue: Promise<unknown> = Promise.resolve();

    private db(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') {
                    reject(new Error('IndexedDB is not available in this environment'));
                    return;
                }
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
                        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: ['accountKey', 'sessionId', 'id'] });
                        store.createIndex(INDEX_SESSION_SEQ, ['accountKey', 'sessionId', 'seq'], { unique: true });
                        store.createIndex(INDEX_SESSION_LOCAL_ID, ['accountKey', 'sessionId', 'localId'], { unique: false });
                    }
                    if (!db.objectStoreNames.contains(STATES_STORE)) {
                        db.createObjectStore(STATES_STORE, { keyPath: ['accountKey', 'sessionId'] });
                    }
                    let pendingDeliveryIssuesStore: IDBObjectStore | null = null;
                    if (!db.objectStoreNames.contains(PENDING_DELIVERY_ISSUES_STORE)) {
                        pendingDeliveryIssuesStore = db.createObjectStore(PENDING_DELIVERY_ISSUES_STORE, {
                            keyPath: ['accountKey', 'sessionId', 'identityType', 'identityValue'],
                        });
                    } else {
                        pendingDeliveryIssuesStore = request.transaction?.objectStore(PENDING_DELIVERY_ISSUES_STORE) ?? null;
                    }
                    if (pendingDeliveryIssuesStore && !pendingDeliveryIssuesStore.indexNames.contains(INDEX_PENDING_DELIVERY_SESSION)) {
                        pendingDeliveryIssuesStore.createIndex(INDEX_PENDING_DELIVERY_SESSION, ['accountKey', 'sessionId'], { unique: false });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
            });
        }
        return this.dbPromise;
    }

    private async enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.writeQueue.then(fn, fn);
        this.writeQueue = run.catch(() => undefined);
        return run;
    }

    async upsertMessages(accountKey: string, sessionId: string, messages: ApiMessage[]): Promise<void> {
        if (messages.length === 0) return;
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, PENDING_DELIVERY_ISSUES_STORE], 'readwrite');
            const store = tx.objectStore(MESSAGES_STORE);
            const pendingStore = tx.objectStore(PENDING_DELIVERY_ISSUES_STORE);
            const bySeq = store.index(INDEX_SESSION_SEQ);
            const now = Date.now();
            await this.putMessagesInTransaction(store, pendingStore, bySeq, accountKey, sessionId, messages, now);
            await transactionDone(tx);
        });
    }

    async upsertMessagesAndUpdateState(accountKey: string, sessionId: string, messages: ApiMessage[], patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        return this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, PENDING_DELIVERY_ISSUES_STORE, STATES_STORE], 'readwrite');
            const messageStore = tx.objectStore(MESSAGES_STORE);
            const pendingStore = tx.objectStore(PENDING_DELIVERY_ISSUES_STORE);
            const stateStore = tx.objectStore(STATES_STORE);
            const bySeq = messageStore.index(INDEX_SESSION_SEQ);
            const now = Date.now();

            await this.putMessagesInTransaction(messageStore, pendingStore, bySeq, accountKey, sessionId, messages, now);
            const existingStored = await requestToPromise<StoredState | undefined>(stateStore.get([accountKey, sessionId]));
            const existing = existingStored ? storedStateToState(existingStored) : null;
            const next = mergeSessionState(existing, patch, now);
            stateStore.put(stateToStoredState(accountKey, sessionId, next));
            await transactionDone(tx);
            return next;
        });
    }

    async getLatestMessages(accountKey: string, sessionId: string, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const tx = db.transaction(MESSAGES_STORE, 'readonly');
        const index = tx.objectStore(MESSAGES_STORE).index(INDEX_SESSION_SEQ);
        const range = sessionSeqRange(accountKey, sessionId, MIN_SEQ_KEY, MAX_SEQ_KEY);
        const { items, hasMore } = await collectCursor<StoredMessage>(index.openCursor(range, 'prev'), limit);
        await transactionDone(tx);
        return toMessagePage(items.map(toApiMessage), hasMore);
    }

    async getMessagesAfter(accountKey: string, sessionId: string, afterSeq: number, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const tx = db.transaction(MESSAGES_STORE, 'readonly');
        const index = tx.objectStore(MESSAGES_STORE).index(INDEX_SESSION_SEQ);
        const range = sessionSeqRange(accountKey, sessionId, afterSeq, MAX_SEQ_KEY, true, false);
        const { items, hasMore } = await collectCursor<StoredMessage>(index.openCursor(range, 'next'), limit);
        await transactionDone(tx);
        return toMessagePage(items.map(toApiMessage), hasMore);
    }

    async getMessagesBefore(accountKey: string, sessionId: string, beforeSeq: number, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const tx = db.transaction(MESSAGES_STORE, 'readonly');
        const index = tx.objectStore(MESSAGES_STORE).index(INDEX_SESSION_SEQ);
        const range = sessionSeqRange(accountKey, sessionId, MIN_SEQ_KEY, beforeSeq, false, true);
        const { items, hasMore } = await collectCursor<StoredMessage>(index.openCursor(range, 'prev'), limit);
        await transactionDone(tx);
        return toMessagePage(items.map(toApiMessage), hasMore);
    }

    async getSessionState(accountKey: string, sessionId: string): Promise<SessionMessageCacheState | null> {
        const db = await this.db();
        const tx = db.transaction(STATES_STORE, 'readonly');
        const stored = await requestToPromise<StoredState | undefined>(tx.objectStore(STATES_STORE).get([accountKey, sessionId]));
        await transactionDone(tx);
        return stored ? storedStateToState(stored) : null;
    }

    async updateSessionState(accountKey: string, sessionId: string, patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        return this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction(STATES_STORE, 'readwrite');
            const store = tx.objectStore(STATES_STORE);
            const existingStored = await requestToPromise<StoredState | undefined>(store.get([accountKey, sessionId]));
            const existing = existingStored ? storedStateToState(existingStored) : null;
            const next = mergeSessionState(existing, patch);
            store.put(stateToStoredState(accountKey, sessionId, next));
            await transactionDone(tx);
            return next;
        });
    }

    async clearSession(accountKey: string, sessionId: string): Promise<void> {
        await this.deleteSessions(accountKey, [sessionId]);
    }

    async deleteSessions(accountKey: string, sessionIds: string[]): Promise<void> {
        if (sessionIds.length === 0) return;
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, STATES_STORE, PENDING_DELIVERY_ISSUES_STORE], 'readwrite');
            const messages = tx.objectStore(MESSAGES_STORE);
            const states = tx.objectStore(STATES_STORE);
            const pendingDeliveryIssues = tx.objectStore(PENDING_DELIVERY_ISSUES_STORE);
            const bySeq = messages.index(INDEX_SESSION_SEQ);
            const pendingBySession = pendingDeliveryIssues.index(INDEX_PENDING_DELIVERY_SESSION);
            for (const sessionId of sessionIds) {
                await this.deleteMessagesForSession(bySeq, messages, accountKey, sessionId);
                states.delete([accountKey, sessionId]);
                await this.deletePendingDeliveryIssuesForSession(pendingBySession, pendingDeliveryIssues, accountKey, sessionId);
            }
            await transactionDone(tx);
        });
    }

    async updateDeliveryIssue(accountKey: string, sessionId: string, identity: { messageId?: string; localId?: string | null }, issue: ApiMessage['deliveryIssue'] | null | undefined): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, PENDING_DELIVERY_ISSUES_STORE], 'readwrite');
            const store = tx.objectStore(MESSAGES_STORE);
            const pendingStore = tx.objectStore(PENDING_DELIVERY_ISSUES_STORE);
            const updatedAt = Date.now();
            let found = false;
            const update = (message: StoredMessage | undefined) => {
                if (!message) return;
                found = true;
                store.put({
                    ...message,
                    deliveryStatus: issue?.status ?? null,
                    deliveryReason: issue?.reason ?? null,
                    updatedAt,
                } satisfies StoredMessage);
            };
            if (identity.messageId) {
                update(await requestToPromise<StoredMessage | undefined>(store.get([accountKey, sessionId, identity.messageId])));
            }
            if (identity.localId) {
                const byLocalId = store.index(INDEX_SESSION_LOCAL_ID);
                const matches = await requestToPromise<StoredMessage[]>(byLocalId.getAll([accountKey, sessionId, identity.localId]));
                for (const match of matches) update(match);
            }

            const identities = deliveryIssueIdentities(identity);
            if (found || !issue) {
                for (const item of identities) {
                    pendingStore.delete(pendingDeliveryIssueKey(accountKey, sessionId, item.type, item.value));
                }
            } else {
                for (const item of identities) {
                    pendingStore.put({
                        accountKey,
                        sessionId,
                        identityType: item.type,
                        identityValue: item.value,
                        deliveryStatus: issue.status,
                        deliveryReason: issue.reason ?? null,
                        updatedAt,
                    } satisfies StoredPendingDeliveryIssue);
                }
            }
            await transactionDone(tx);
        });
    }

    async clearAccount(accountKey: string): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, STATES_STORE, PENDING_DELIVERY_ISSUES_STORE], 'readwrite');
            await this.deleteByAccount(tx.objectStore(MESSAGES_STORE), accountKey);
            await this.deleteByAccount(tx.objectStore(STATES_STORE), accountKey);
            await this.deleteByAccount(tx.objectStore(PENDING_DELIVERY_ISSUES_STORE), accountKey);
            await transactionDone(tx);
        });
    }

    async clearAll(): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const tx = db.transaction([MESSAGES_STORE, STATES_STORE, PENDING_DELIVERY_ISSUES_STORE], 'readwrite');
            tx.objectStore(MESSAGES_STORE).clear();
            tx.objectStore(STATES_STORE).clear();
            tx.objectStore(PENDING_DELIVERY_ISSUES_STORE).clear();
            await transactionDone(tx);
        });
    }

    private async putMessagesInTransaction(
        store: IDBObjectStore,
        pendingStore: IDBObjectStore,
        bySeq: IDBIndex,
        accountKey: string,
        sessionId: string,
        messages: ApiMessage[],
        now: number,
    ): Promise<void> {
        for (const input of messages) {
            const stored = toStoredMessage(accountKey, sessionId, input, now);
            await this.applyPendingDeliveryIssue(pendingStore, accountKey, sessionId, stored);
            const seqMatches = await requestToPromise<StoredMessage[]>(bySeq.getAll([accountKey, sessionId, stored.seq]));
            for (const existing of seqMatches) {
                if (existing.id !== stored.id) {
                    store.delete([accountKey, sessionId, existing.id]);
                }
            }
            store.put(stored);
        }
    }

    private async applyPendingDeliveryIssue(store: IDBObjectStore, accountKey: string, sessionId: string, message: StoredMessage): Promise<void> {
        const identities = deliveryIssueIdentities({ messageId: message.id, localId: message.localId });
        let latest: StoredPendingDeliveryIssue | null = null;
        for (const identity of identities) {
            const pending = await requestToPromise<StoredPendingDeliveryIssue | undefined>(
                store.get(pendingDeliveryIssueKey(accountKey, sessionId, identity.type, identity.value)),
            );
            if (!pending) continue;
            if (!latest || pending.updatedAt >= latest.updatedAt) {
                latest = pending;
            }
        }

        if (latest) {
            message.deliveryStatus = latest.deliveryStatus;
            message.deliveryReason = latest.deliveryReason;
            message.updatedAt = Math.max(message.updatedAt, latest.updatedAt);
        }

        for (const identity of identities) {
            store.delete(pendingDeliveryIssueKey(accountKey, sessionId, identity.type, identity.value));
        }
    }

    private async deleteMessagesForSession(index: IDBIndex, store: IDBObjectStore, accountKey: string, sessionId: string): Promise<void> {
        const range = sessionSeqRange(accountKey, sessionId, MIN_SEQ_KEY, MAX_SEQ_KEY);
        await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(range);
            request.onerror = () => reject(request.error ?? new Error('Failed to delete session messages'));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                store.delete(cursor.primaryKey);
                cursor.continue();
            };
        });
    }

    private async deletePendingDeliveryIssuesForSession(index: IDBIndex, store: IDBObjectStore, accountKey: string, sessionId: string): Promise<void> {
        const range = IDBKeyRange.only([accountKey, sessionId]);
        await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(range);
            request.onerror = () => reject(request.error ?? new Error('Failed to delete pending delivery issues'));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                store.delete(cursor.primaryKey);
                cursor.continue();
            };
        });
    }

    private async deleteByAccount(store: IDBObjectStore, accountKey: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const request = store.openCursor();
            request.onerror = () => reject(request.error ?? new Error('Failed to clear account cache'));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                const value = cursor.value as { accountKey?: string };
                if (value.accountKey === accountKey) {
                    store.delete(cursor.primaryKey);
                }
                cursor.continue();
            };
        });
    }
}

export const messageRepository: MessageRepository = new IndexedDBMessageRepository();

import * as SQLite from 'expo-sqlite';
import type { ApiMessage } from '../apiTypes';
import { mergeSessionState, toMessagePage } from './common';
import type { MessagePage, MessageRepository, SessionMessageCacheState, SessionMessageCacheStatePatch } from './types';

const DATABASE_NAME = 'happy-message-cache-v1.db';
const MESSAGES_TABLE = 'message_cache_messages';
const STATES_TABLE = 'message_cache_session_state';
const PENDING_DELIVERY_ISSUES_TABLE = 'message_cache_pending_delivery_issues';

type SQLiteDB = SQLite.SQLiteDatabase;

type MessageRow = {
    account_key: string;
    session_id: string;
    id: string;
    seq: number;
    local_id: string | null;
    content_ciphertext: string;
    sent_by: string | null;
    sent_by_name: string | null;
    delivery_status: 'waiting' | 'error' | null;
    delivery_reason: string | null;
    created_at: number;
    updated_at: number;
    stored_at: number;
};

type StateRow = {
    account_key: string;
    session_id: string;
    forward_max_seq: number;
    oldest_loaded_seq: number | null;
    has_more_older: number;
    contiguous_min_seq: number | null;
    contiguous_max_seq: number | null;
    remote_oldest_seq: number | null;
    invalidated_at: number | null;
    updated_at: number;
};

type PendingDeliveryIssueIdentityType = 'messageId' | 'localId';

type PendingDeliveryIssueRow = {
    account_key: string;
    session_id: string;
    identity_type: PendingDeliveryIssueIdentityType;
    identity_value: string;
    delivery_status: 'waiting' | 'error';
    delivery_reason: string | null;
    updated_at: number;
};

function rowToApiMessage(row: MessageRow): ApiMessage {
    return {
        id: row.id,
        seq: row.seq,
        localId: row.local_id,
        content: { t: 'encrypted', c: row.content_ciphertext },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sentBy: row.sent_by,
        sentByName: row.sent_by_name,
        deliveryIssue: row.delivery_status
            ? { status: row.delivery_status, reason: row.delivery_reason }
            : undefined,
    };
}

function rowToState(row: StateRow): SessionMessageCacheState {
    return {
        forwardMaxSeq: row.forward_max_seq,
        oldestLoadedSeq: row.oldest_loaded_seq,
        hasMoreOlder: row.has_more_older === 1,
        contiguousMinSeq: row.contiguous_min_seq ?? null,
        contiguousMaxSeq: row.contiguous_max_seq ?? null,
        remoteOldestSeq: row.remote_oldest_seq ?? null,
        invalidatedAt: row.invalidated_at,
        updatedAt: row.updated_at,
    };
}

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

class SQLiteMessageRepository implements MessageRepository {
    private dbPromise: Promise<SQLiteDB> | null = null;
    private writeQueue: Promise<unknown> = Promise.resolve();

    private async db(): Promise<SQLiteDB> {
        if (!this.dbPromise) {
            this.dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
                await db.execAsync(`
                    PRAGMA journal_mode = WAL;
                    CREATE TABLE IF NOT EXISTS ${MESSAGES_TABLE} (
                        account_key TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        id TEXT NOT NULL,
                        seq INTEGER NOT NULL,
                        local_id TEXT,
                        content_ciphertext TEXT NOT NULL,
                        sent_by TEXT,
                        sent_by_name TEXT,
                        delivery_status TEXT,
                        delivery_reason TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        stored_at INTEGER NOT NULL,
                        PRIMARY KEY (account_key, session_id, id)
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_cache_session_seq
                        ON ${MESSAGES_TABLE}(account_key, session_id, seq);
                    CREATE INDEX IF NOT EXISTS idx_message_cache_session_local_id
                        ON ${MESSAGES_TABLE}(account_key, session_id, local_id);
                    CREATE TABLE IF NOT EXISTS ${STATES_TABLE} (
                        account_key TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        forward_max_seq INTEGER NOT NULL DEFAULT 0,
                        oldest_loaded_seq INTEGER,
                        has_more_older INTEGER NOT NULL DEFAULT 1,
                        contiguous_min_seq INTEGER,
                        contiguous_max_seq INTEGER,
                        remote_oldest_seq INTEGER,
                        invalidated_at INTEGER,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (account_key, session_id)
                    );
                    CREATE TABLE IF NOT EXISTS ${PENDING_DELIVERY_ISSUES_TABLE} (
                        account_key TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        identity_type TEXT NOT NULL,
                        identity_value TEXT NOT NULL,
                        delivery_status TEXT NOT NULL,
                        delivery_reason TEXT,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (account_key, session_id, identity_type, identity_value)
                    );
                    CREATE INDEX IF NOT EXISTS idx_message_cache_pending_delivery_session
                        ON ${PENDING_DELIVERY_ISSUES_TABLE}(account_key, session_id);
                `);
                await this.ensureStateColumn(db, 'contiguous_min_seq', 'INTEGER');
                await this.ensureStateColumn(db, 'contiguous_max_seq', 'INTEGER');
                await this.ensureStateColumn(db, 'remote_oldest_seq', 'INTEGER');
                return db;
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
            const now = Date.now();
            await db.withTransactionAsync(async () => {
                await this.upsertMessagesInTransaction(db, accountKey, sessionId, messages, now);
            });
        });
    }

    async upsertMessagesAndUpdateState(accountKey: string, sessionId: string, messages: ApiMessage[], patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        return this.enqueueWrite(async () => {
            const db = await this.db();
            const now = Date.now();
            let next: SessionMessageCacheState | null = null;
            await db.withTransactionAsync(async () => {
                await this.upsertMessagesInTransaction(db, accountKey, sessionId, messages, now);
                const existingRow = await db.getFirstAsync<StateRow>(
                    `SELECT * FROM ${STATES_TABLE} WHERE account_key = ? AND session_id = ?`,
                    accountKey,
                    sessionId,
                );
                const existing = existingRow ? rowToState(existingRow) : null;
                next = mergeSessionState(existing, patch, now);
                await this.putSessionState(db, accountKey, sessionId, next);
            });
            return next!;
        });
    }

    async getLatestMessages(accountKey: string, sessionId: string, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const rows = await db.getAllAsync<MessageRow>(
            `SELECT * FROM ${MESSAGES_TABLE}
             WHERE account_key = ? AND session_id = ?
             ORDER BY seq DESC
             LIMIT ?`,
            accountKey,
            sessionId,
            limit + 1,
        );
        const pageRows = rows.slice(0, limit);
        return toMessagePage(pageRows.map(rowToApiMessage), rows.length > limit);
    }

    async getMessagesAfter(accountKey: string, sessionId: string, afterSeq: number, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const rows = await db.getAllAsync<MessageRow>(
            `SELECT * FROM ${MESSAGES_TABLE}
             WHERE account_key = ? AND session_id = ? AND seq > ?
             ORDER BY seq ASC
             LIMIT ?`,
            accountKey,
            sessionId,
            afterSeq,
            limit + 1,
        );
        const pageRows = rows.slice(0, limit);
        return toMessagePage(pageRows.map(rowToApiMessage), rows.length > limit);
    }

    async getMessagesBefore(accountKey: string, sessionId: string, beforeSeq: number, limit: number): Promise<MessagePage> {
        const db = await this.db();
        const rows = await db.getAllAsync<MessageRow>(
            `SELECT * FROM ${MESSAGES_TABLE}
             WHERE account_key = ? AND session_id = ? AND seq < ?
             ORDER BY seq DESC
             LIMIT ?`,
            accountKey,
            sessionId,
            beforeSeq,
            limit + 1,
        );
        const pageRows = rows.slice(0, limit);
        return toMessagePage(pageRows.map(rowToApiMessage), rows.length > limit);
    }

    async getSessionState(accountKey: string, sessionId: string): Promise<SessionMessageCacheState | null> {
        const db = await this.db();
        const row = await db.getFirstAsync<StateRow>(
            `SELECT * FROM ${STATES_TABLE} WHERE account_key = ? AND session_id = ?`,
            accountKey,
            sessionId,
        );
        return row ? rowToState(row) : null;
    }

    async updateSessionState(accountKey: string, sessionId: string, patch: SessionMessageCacheStatePatch): Promise<SessionMessageCacheState> {
        return this.enqueueWrite(async () => {
            const db = await this.db();
            const existing = await this.getSessionState(accountKey, sessionId);
            const next = mergeSessionState(existing, patch);
            await this.putSessionState(db, accountKey, sessionId, next);
            return next;
        });
    }

    async clearSession(accountKey: string, sessionId: string): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            await db.withTransactionAsync(async () => {
                await db.runAsync(`DELETE FROM ${MESSAGES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
                await db.runAsync(`DELETE FROM ${STATES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
                await db.runAsync(`DELETE FROM ${PENDING_DELIVERY_ISSUES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
            });
        });
    }

    async deleteSessions(accountKey: string, sessionIds: string[]): Promise<void> {
        if (sessionIds.length === 0) return;
        await this.enqueueWrite(async () => {
            const db = await this.db();
            await db.withTransactionAsync(async () => {
                for (const sessionId of sessionIds) {
                    await db.runAsync(`DELETE FROM ${MESSAGES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
                    await db.runAsync(`DELETE FROM ${STATES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
                    await db.runAsync(`DELETE FROM ${PENDING_DELIVERY_ISSUES_TABLE} WHERE account_key = ? AND session_id = ?`, accountKey, sessionId);
                }
            });
        });
    }

    async updateDeliveryIssue(accountKey: string, sessionId: string, identity: { messageId?: string; localId?: string | null }, issue: ApiMessage['deliveryIssue'] | null | undefined): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            const status = issue?.status ?? null;
            const reason = issue?.reason ?? null;
            const updatedAt = Date.now();
            const identities = deliveryIssueIdentities(identity);
            await db.withTransactionAsync(async () => {
                let found = false;
                if (identity.messageId) {
                    const existing = await db.getFirstAsync<MessageRow>(
                        `SELECT * FROM ${MESSAGES_TABLE}
                         WHERE account_key = ? AND session_id = ? AND id = ?`,
                        accountKey,
                        sessionId,
                        identity.messageId,
                    );
                    if (existing) {
                        found = true;
                        await db.runAsync(
                            `UPDATE ${MESSAGES_TABLE}
                             SET delivery_status = ?, delivery_reason = ?, updated_at = ?
                             WHERE account_key = ? AND session_id = ? AND id = ?`,
                            status,
                            reason,
                            updatedAt,
                            accountKey,
                            sessionId,
                            identity.messageId,
                        );
                    }
                }
                if (identity.localId) {
                    const matches = await db.getAllAsync<MessageRow>(
                        `SELECT * FROM ${MESSAGES_TABLE}
                         WHERE account_key = ? AND session_id = ? AND local_id = ?`,
                        accountKey,
                        sessionId,
                        identity.localId,
                    );
                    if (matches.length > 0) {
                        found = true;
                        await db.runAsync(
                            `UPDATE ${MESSAGES_TABLE}
                             SET delivery_status = ?, delivery_reason = ?, updated_at = ?
                             WHERE account_key = ? AND session_id = ? AND local_id = ?`,
                            status,
                            reason,
                            updatedAt,
                            accountKey,
                            sessionId,
                            identity.localId,
                        );
                    }
                }

                if (found || !issue) {
                    for (const item of identities) {
                        await this.deletePendingDeliveryIssue(db, accountKey, sessionId, item.type, item.value);
                    }
                    return;
                }

                for (const item of identities) {
                    await db.runAsync(
                        `INSERT INTO ${PENDING_DELIVERY_ISSUES_TABLE} (
                            account_key, session_id, identity_type, identity_value,
                            delivery_status, delivery_reason, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(account_key, session_id, identity_type, identity_value) DO UPDATE SET
                            delivery_status = excluded.delivery_status,
                            delivery_reason = excluded.delivery_reason,
                            updated_at = excluded.updated_at`,
                        accountKey,
                        sessionId,
                        item.type,
                        item.value,
                        issue.status,
                        issue.reason ?? null,
                        updatedAt,
                    );
                }
            });
        });
    }

    async clearAccount(accountKey: string): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            await db.withTransactionAsync(async () => {
                await db.runAsync(`DELETE FROM ${MESSAGES_TABLE} WHERE account_key = ?`, accountKey);
                await db.runAsync(`DELETE FROM ${STATES_TABLE} WHERE account_key = ?`, accountKey);
                await db.runAsync(`DELETE FROM ${PENDING_DELIVERY_ISSUES_TABLE} WHERE account_key = ?`, accountKey);
            });
        });
    }

    async clearAll(): Promise<void> {
        await this.enqueueWrite(async () => {
            const db = await this.db();
            await db.withTransactionAsync(async () => {
                await db.runAsync(`DELETE FROM ${MESSAGES_TABLE}`);
                await db.runAsync(`DELETE FROM ${STATES_TABLE}`);
                await db.runAsync(`DELETE FROM ${PENDING_DELIVERY_ISSUES_TABLE}`);
            });
        });
    }

    private async ensureStateColumn(db: SQLiteDB, columnName: string, columnType: string): Promise<void> {
        try {
            await db.runAsync(`ALTER TABLE ${STATES_TABLE} ADD COLUMN ${columnName} ${columnType}`);
        } catch {
            // SQLite throws when the column already exists. CREATE TABLE above handles fresh DBs.
        }
    }

    private async putSessionState(db: SQLiteDB, accountKey: string, sessionId: string, state: SessionMessageCacheState): Promise<void> {
        await db.runAsync(
            `INSERT INTO ${STATES_TABLE} (
                account_key, session_id, forward_max_seq, oldest_loaded_seq,
                has_more_older, contiguous_min_seq, contiguous_max_seq, remote_oldest_seq,
                invalidated_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_key, session_id) DO UPDATE SET
                forward_max_seq = excluded.forward_max_seq,
                oldest_loaded_seq = excluded.oldest_loaded_seq,
                has_more_older = excluded.has_more_older,
                contiguous_min_seq = excluded.contiguous_min_seq,
                contiguous_max_seq = excluded.contiguous_max_seq,
                remote_oldest_seq = excluded.remote_oldest_seq,
                invalidated_at = excluded.invalidated_at,
                updated_at = excluded.updated_at`,
            accountKey,
            sessionId,
            state.forwardMaxSeq,
            state.oldestLoadedSeq,
            state.hasMoreOlder ? 1 : 0,
            state.contiguousMinSeq,
            state.contiguousMaxSeq,
            state.remoteOldestSeq,
            state.invalidatedAt,
            state.updatedAt,
        );
    }

    private async upsertMessagesInTransaction(db: SQLiteDB, accountKey: string, sessionId: string, messages: ApiMessage[], now: number): Promise<void> {
        for (const input of messages) {
            const message = normalizeMessage(input);
            const pendingIssue = await this.takePendingDeliveryIssue(db, accountKey, sessionId, message.id, message.localId ?? null);
            const deliveryIssue = pendingIssue
                ? { status: pendingIssue.delivery_status, reason: pendingIssue.delivery_reason }
                : message.deliveryIssue;
            const updatedAt = pendingIssue
                ? Math.max(message.updatedAt ?? message.createdAt, pendingIssue.updated_at)
                : message.updatedAt ?? message.createdAt;
            await db.runAsync(
                `DELETE FROM ${MESSAGES_TABLE}
                 WHERE account_key = ? AND session_id = ? AND seq = ? AND id != ?`,
                accountKey,
                sessionId,
                message.seq,
                message.id,
            );
            await db.runAsync(
                `INSERT INTO ${MESSAGES_TABLE} (
                    account_key, session_id, id, seq, local_id, content_ciphertext,
                    sent_by, sent_by_name, delivery_status, delivery_reason,
                    created_at, updated_at, stored_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, session_id, id) DO UPDATE SET
                    seq = excluded.seq,
                    local_id = excluded.local_id,
                    content_ciphertext = excluded.content_ciphertext,
                    sent_by = excluded.sent_by,
                    sent_by_name = excluded.sent_by_name,
                    delivery_status = excluded.delivery_status,
                    delivery_reason = excluded.delivery_reason,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    stored_at = excluded.stored_at`,
                accountKey,
                sessionId,
                message.id,
                message.seq,
                message.localId ?? null,
                message.content.c,
                message.sentBy ?? null,
                message.sentByName ?? null,
                deliveryIssue?.status ?? null,
                deliveryIssue?.reason ?? null,
                message.createdAt,
                updatedAt,
                now,
            );
        }
    }

    private async takePendingDeliveryIssue(
        db: SQLiteDB,
        accountKey: string,
        sessionId: string,
        messageId: string,
        localId: string | null,
    ): Promise<PendingDeliveryIssueRow | null> {
        const identities = deliveryIssueIdentities({ messageId, localId });
        let latest: PendingDeliveryIssueRow | null = null;
        for (const identity of identities) {
            const row = await db.getFirstAsync<PendingDeliveryIssueRow>(
                `SELECT * FROM ${PENDING_DELIVERY_ISSUES_TABLE}
                 WHERE account_key = ? AND session_id = ? AND identity_type = ? AND identity_value = ?`,
                accountKey,
                sessionId,
                identity.type,
                identity.value,
            );
            if (!row) continue;
            if (!latest || row.updated_at >= latest.updated_at) {
                latest = row;
            }
        }

        for (const identity of identities) {
            await this.deletePendingDeliveryIssue(db, accountKey, sessionId, identity.type, identity.value);
        }

        return latest;
    }

    private async deletePendingDeliveryIssue(
        db: SQLiteDB,
        accountKey: string,
        sessionId: string,
        identityType: PendingDeliveryIssueIdentityType,
        identityValue: string,
    ): Promise<void> {
        await db.runAsync(
            `DELETE FROM ${PENDING_DELIVERY_ISSUES_TABLE}
             WHERE account_key = ? AND session_id = ? AND identity_type = ? AND identity_value = ?`,
            accountKey,
            sessionId,
            identityType,
            identityValue,
        );
    }
}

export const messageRepository: MessageRepository = new SQLiteMessageRepository();

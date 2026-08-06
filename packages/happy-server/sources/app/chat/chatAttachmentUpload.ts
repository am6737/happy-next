import { randomKey } from '@/utils/randomKey';
import { s3client, s3privateBucket } from '@/storage/files';
import { db } from '@/storage/db';
import { queueAttachmentObjectDeletions } from '@/app/chat/attachmentObjectDeletion';
import { Prisma } from '@prisma/client';
import { Transform, type Readable } from 'node:stream';

const SECRETBOX_OVERHEAD_BYTES = 16;
const MAX_ATTACHMENT_PLAINTEXT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_CIPHERTEXT_BYTES = MAX_ATTACHMENT_PLAINTEXT_BYTES + SECRETBOX_OVERHEAD_BYTES;
export const ATTACHMENT_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

function quotaFromEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const CHAT_ATTACHMENT_ACCOUNT_QUOTA_BYTES = quotaFromEnv('CHAT_ATTACHMENT_ACCOUNT_QUOTA_BYTES', 5 * 1024 * 1024 * 1024);
export const CHAT_ATTACHMENT_SESSION_QUOTA_BYTES = quotaFromEnv('CHAT_ATTACHMENT_SESSION_QUOTA_BYTES', 1024 * 1024 * 1024);
export const CHAT_ATTACHMENT_ACCOUNT_UNCOMMITTED_LIMIT = quotaFromEnv('CHAT_ATTACHMENT_ACCOUNT_UNCOMMITTED_LIMIT', 100);
export const CHAT_ATTACHMENT_SESSION_UNCOMMITTED_LIMIT = quotaFromEnv('CHAT_ATTACHMENT_SESSION_UNCOMMITTED_LIMIT', 25);

export class AttachmentQuotaError extends Error {
    constructor(readonly scope: 'account' | 'session', readonly quota: 'storage' | 'uncommitted' = 'storage') {
        super(quota === 'storage'
            ? `${scope === 'account' ? 'Account' : 'Session'} attachment storage quota exceeded`
            : `${scope === 'account' ? 'Account' : 'Session'} uncommitted attachment limit exceeded`);
        this.name = 'AttachmentQuotaError';
    }
}

export class AttachmentSizeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AttachmentSizeError';
    }
}

async function reserveAttachment(input: {
    accountId: string;
    sessionId: string;
    path: string;
    size: number;
}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await db.$transaction(async (tx) => {
                const [accountUsage, sessionUsage, accountUncommitted, sessionUncommitted] = await Promise.all([
                    tx.chatAttachment.aggregate({
                        where: { accountId: input.accountId },
                        _sum: { size: true },
                    }),
                    tx.chatAttachment.aggregate({
                        where: { sessionId: input.sessionId },
                        _sum: { size: true },
                    }),
                    tx.chatAttachment.count({
                        where: { accountId: input.accountId, committedAt: null },
                    }),
                    tx.chatAttachment.count({
                        where: { sessionId: input.sessionId, committedAt: null },
                    }),
                ]);
                if ((accountUsage._sum.size ?? 0) + input.size > CHAT_ATTACHMENT_ACCOUNT_QUOTA_BYTES) {
                    throw new AttachmentQuotaError('account');
                }
                if ((sessionUsage._sum.size ?? 0) + input.size > CHAT_ATTACHMENT_SESSION_QUOTA_BYTES) {
                    throw new AttachmentQuotaError('session');
                }
                if (accountUncommitted >= CHAT_ATTACHMENT_ACCOUNT_UNCOMMITTED_LIMIT) {
                    throw new AttachmentQuotaError('account', 'uncommitted');
                }
                if (sessionUncommitted >= CHAT_ATTACHMENT_SESSION_UNCOMMITTED_LIMIT) {
                    throw new AttachmentQuotaError('session', 'uncommitted');
                }
                return tx.chatAttachment.create({
                    data: {
                        accountId: input.accountId,
                        sessionId: input.sessionId,
                        path: input.path,
                        size: input.size,
                        encryptionVersion: 2,
                        expiresAt: new Date(Date.now() + ATTACHMENT_LEASE_TTL_MS),
                    },
                });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
                continue;
            }
            throw error;
        }
    }
    throw new Error('Unable to reserve attachment storage');
}

export async function chatAttachmentUpload(input: {
    accountId: string;
    sessionId: string;
    stream: Readable & { truncated?: boolean };
    size: number;
}) {
    if (!Number.isSafeInteger(input.size)
        || input.size < SECRETBOX_OVERHEAD_BYTES
        || input.size > MAX_ATTACHMENT_CIPHERTEXT_BYTES) {
        throw new AttachmentSizeError('Invalid encrypted attachment size');
    }
    const key = randomKey('att');
    const path = `users/${input.accountId}/chat/${input.sessionId}/${key}`;
    const attachment = await reserveAttachment({
        accountId: input.accountId,
        sessionId: input.sessionId,
        path,
        size: input.size,
    });
    let received = 0;
    const limitedStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            if (received > input.size) {
                callback(new AttachmentSizeError('Encrypted attachment exceeds declared size'));
                return;
            }
            callback(null, chunk);
        },
    });
    input.stream.pipe(limitedStream);
    try {
        await s3client.putObject(s3privateBucket, path, limitedStream, input.size, {
            'Content-Type': 'application/octet-stream',
        });
        if (input.stream.truncated) {
            throw new AttachmentSizeError('Encrypted attachment exceeds size limit');
        }
        if (received !== input.size) {
            throw new AttachmentSizeError('Encrypted attachment size mismatch');
        }
    } catch (error) {
        input.stream.unpipe(limitedStream);
        limitedStream.destroy();
        try {
            await s3client.removeObject(s3privateBucket, path);
            await db.chatAttachment.deleteMany({ where: { id: attachment.id, committedAt: null } });
        } catch {
            await db.$transaction(async (tx) => {
                await queueAttachmentObjectDeletions(tx, [path]);
                await tx.chatAttachment.deleteMany({ where: { id: attachment.id, committedAt: null } });
            }).catch(() => undefined);
        }
        throw error;
    }

    return {
        v: 2 as const,
        id: attachment.id,
        ciphertextSize: attachment.size,
    };
}

import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { delay } from '@/utils/delay';
import { forever } from '@/utils/forever';
import { log } from '@/utils/log';
import { shutdownSignal } from '@/utils/shutdown';

export const ATTACHMENT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const ATTACHMENT_CLEANUP_BATCH_SIZE = 100;
const ATTACHMENT_CLEANUP_CLAIM_TIMEOUT_MS = 60 * 60 * 1000;

export class AttachmentLeaseError extends Error {
    constructor() {
        super('Invalid or expired attachment lease');
        this.name = 'AttachmentLeaseError';
    }
}

export async function commitAttachmentLeases(
    tx: Prisma.TransactionClient,
    input: {
        attachmentIds: string[];
        accountId: string;
        sessionId: string;
        messageLocalId: string;
    },
): Promise<void> {
    if (input.attachmentIds.length === 0) return;
    const ids = [...new Set(input.attachmentIds)];
    if (ids.length !== input.attachmentIds.length) throw new AttachmentLeaseError();
    const attachments = await tx.chatAttachment.findMany({
        where: { id: { in: ids } },
        select: {
            id: true,
            accountId: true,
            sessionId: true,
            committedAt: true,
            expiresAt: true,
            messageLocalId: true,
            cleanupStartedAt: true,
        },
    });
    const now = new Date();
    if (attachments.length !== ids.length || attachments.some((attachment) => (
        attachment.accountId !== input.accountId
        || attachment.sessionId !== input.sessionId
        || attachment.cleanupStartedAt !== null
        || (attachment.committedAt === null && (!attachment.expiresAt || attachment.expiresAt <= now))
        || (attachment.committedAt !== null && attachment.messageLocalId !== input.messageLocalId)
    ))) {
        throw new AttachmentLeaseError();
    }

    const uncommittedCount = attachments.filter((attachment) => attachment.committedAt === null).length;
    const committed = await tx.chatAttachment.updateMany({
        where: {
            id: { in: ids },
            accountId: input.accountId,
            sessionId: input.sessionId,
            committedAt: null,
            expiresAt: { gt: now },
            cleanupStartedAt: null,
        },
        data: {
            committedAt: now,
            expiresAt: null,
            messageLocalId: input.messageLocalId,
        },
    });
    if (committed.count !== uncommittedCount) {
        throw new AttachmentLeaseError();
    }
}

export async function cleanupExpiredAttachmentLeases(now: Date = new Date()): Promise<number> {
    const { s3client, s3privateBucket } = await import('@/storage/files');
    const staleClaimBefore = new Date(now.getTime() - ATTACHMENT_CLEANUP_CLAIM_TIMEOUT_MS);
    const candidates = await db.chatAttachment.findMany({
        where: {
            committedAt: null,
            expiresAt: { lte: now },
            OR: [
                { cleanupStartedAt: null },
                { cleanupStartedAt: { lte: staleClaimBefore } },
            ],
        },
        orderBy: { expiresAt: 'asc' },
        take: ATTACHMENT_CLEANUP_BATCH_SIZE,
        select: { id: true, path: true },
    });
    let removed = 0;
    for (const candidate of candidates) {
        const claimed = await db.chatAttachment.updateMany({
            where: {
                id: candidate.id,
                committedAt: null,
                expiresAt: { lte: now },
                OR: [
                    { cleanupStartedAt: null },
                    { cleanupStartedAt: { lte: staleClaimBefore } },
                ],
            },
            data: { cleanupStartedAt: now },
        });
        if (claimed.count === 0) continue;

        try {
            await s3client.removeObject(s3privateBucket, candidate.path);
            await db.chatAttachment.deleteMany({
                where: { id: candidate.id, committedAt: null, cleanupStartedAt: now },
            });
            removed += 1;
        } catch (error) {
            await db.chatAttachment.updateMany({
                where: { id: candidate.id, committedAt: null, cleanupStartedAt: now },
                data: { cleanupStartedAt: null },
            }).catch(() => undefined);
            log({ module: 'attachment-cleanup', attachmentId: candidate.id, error }, 'Failed to clean expired attachment');
        }
    }
    return removed;
}

export function startAttachmentCleanupWorker() {
    forever('attachment-cleanup', async () => {
        await cleanupExpiredAttachmentLeases();
        await delay(ATTACHMENT_CLEANUP_INTERVAL_MS, shutdownSignal);
    });
}

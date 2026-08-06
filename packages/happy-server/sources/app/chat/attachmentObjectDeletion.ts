import { db } from '@/storage/db';
import { s3client, s3privateBucket } from '@/storage/files';
import { delay } from '@/utils/delay';
import { forever } from '@/utils/forever';
import { log } from '@/utils/log';
import { shutdownSignal } from '@/utils/shutdown';
import type { Prisma } from '@prisma/client';

const DELETE_INTERVAL_MS = 60_000;
const DELETE_BATCH_SIZE = 100;
const DELETE_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

function retryDelayMs(attempts: number): number {
    return Math.min(MAX_RETRY_DELAY_MS, 60_000 * 2 ** Math.min(attempts, 8));
}

function errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

export async function queueAttachmentObjectDeletions(
    tx: Prisma.TransactionClient,
    paths: string[],
): Promise<void> {
    if (paths.length === 0) return;
    await tx.attachmentObjectDeletion.createMany({
        data: [...new Set(paths)].map((path) => ({ path })),
        skipDuplicates: true,
    });
}

export async function processAttachmentObjectDeletions(now: Date = new Date()): Promise<number> {
    const staleClaimBefore = new Date(now.getTime() - DELETE_CLAIM_TIMEOUT_MS);
    const candidates = await db.attachmentObjectDeletion.findMany({
        where: {
            nextAttemptAt: { lte: now },
            OR: [
                { claimedAt: null },
                { claimedAt: { lte: staleClaimBefore } },
            ],
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: DELETE_BATCH_SIZE,
        select: { id: true, path: true, attempts: true },
    });

    let removed = 0;
    for (const candidate of candidates) {
        const claimed = await db.attachmentObjectDeletion.updateMany({
            where: {
                id: candidate.id,
                nextAttemptAt: { lte: now },
                OR: [
                    { claimedAt: null },
                    { claimedAt: { lte: staleClaimBefore } },
                ],
            },
            data: { claimedAt: now },
        });
        if (claimed.count === 0) continue;

        try {
            await s3client.removeObject(s3privateBucket, candidate.path);
            await db.attachmentObjectDeletion.deleteMany({
                where: { id: candidate.id, claimedAt: now },
            });
            removed += 1;
        } catch (error) {
            const attempts = candidate.attempts + 1;
            await db.attachmentObjectDeletion.updateMany({
                where: { id: candidate.id, claimedAt: now },
                data: {
                    attempts,
                    claimedAt: null,
                    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
                    lastError: errorMessage(error),
                },
            }).catch(() => undefined);
            log({ module: 'attachment-object-deletion', path: candidate.path, attempts, error }, 'Failed to delete attachment object');
        }
    }
    return removed;
}

export function startAttachmentObjectDeletionWorker() {
    forever('attachment-object-deletion', async () => {
        await processAttachmentObjectDeletions();
        await delay(DELETE_INTERVAL_MS, shutdownSignal);
    });
}

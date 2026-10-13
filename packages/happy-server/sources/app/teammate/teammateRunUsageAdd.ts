import { db } from '@/storage/db';
import type { TeammateSession } from '@prisma/client';
import { teammateTokenUsage } from './teammateTokenUsage';

/** Attribute a controller report to the latest active run, or a run finished in the last 120 seconds, and add every metric atomically. */
export async function teammateRunUsageAdd(session: TeammateSession, tokens: Record<string, unknown>, cost: Record<string, unknown>, now: Date = new Date()): Promise<void> {
    if (session.role !== 'controller') return;
    const usage = teammateTokenUsage(tokens);
    const costUsd = typeof cost.total === 'number' && Number.isFinite(cost.total) ? cost.total : 0;
    const cutoff = new Date(now.getTime() - 120_000);
    await db.$executeRaw`
        UPDATE "TeammateRun" AS run
        SET "inputTokens" = COALESCE(run."inputTokens", 0) + ${usage.input},
            "cacheReadTokens" = COALESCE(run."cacheReadTokens", 0) + ${usage.cacheRead},
            "cacheWriteTokens" = COALESCE(run."cacheWriteTokens", 0) + ${usage.cacheWrite},
            "outputTokens" = COALESCE(run."outputTokens", 0) + ${usage.output},
            "costUsd" = COALESCE(run."costUsd", 0) + ${costUsd}
        WHERE run.id = (
            SELECT candidate.id FROM "TeammateRun" AS candidate
            WHERE candidate."threadId" = ${session.threadId}
              AND candidate."teammateId" = ${session.teammateId}
              AND (candidate.status IN ('running', 'dispatching')
                   OR (candidate."finishedAt" >= ${cutoff} AND candidate."finishedAt" <= ${now}))
            ORDER BY CASE WHEN candidate.status IN ('running', 'dispatching') THEN 0 ELSE 1 END,
                     CASE WHEN candidate.status IN ('running', 'dispatching') THEN COALESCE(candidate."startedAt", candidate."queuedAt") END DESC,
                     candidate."finishedAt" DESC,
                     candidate.id DESC
            LIMIT 1
        )`;
}

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { assertExecutionCapabilityTx } from './workspaceAuth';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';

export function redactExecutionSummary(value: string): string {
    return value.slice(0, 8_000)
        .replace(/\b(?:https?|postgres(?:ql)?|redis|mysql|mongodb(?:\+srv)?):\/\/[^\s<>"']+/gi,
            (candidate) => {
                try {
                    const url = new URL(candidate);
                    if (url.username || url.password || [...url.searchParams.keys()].some((key) =>
                        /(?:token|signature|secret|password|api[_-]?key|authorization|credential)/i.test(key))) {
                        return '[credential URL]';
                    }
                } catch { return '[unparseable URL]'; }
                return candidate;
            })
        .replace(/\b(?:Bearer\s+|token[=:]\s*)([^\s,;]+)/gi, '[credential]')
        .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/g, '[credential]')
        .replace(/\b[A-Za-z_][A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD)=[^\s]+/g,
            '[environment secret]')
        .replace(/\/(?:home|Users|root|tmp)\/[^\s,;]+/g, '[private path]')
        .slice(0, 2_000);
}

export async function recordExecutionEvent(input: { accountId: string; executionId: string;
    machineId: string; capability: string; eventId: string; seq: number;
    kind: string; phase: string; occurredAt: Date; summary: string }) {
    const payloadHash = createHash('sha256').update(JSON.stringify({ eventId: input.eventId,
        seq: input.seq, kind: input.kind, phase: input.phase,
        occurredAt: input.occurredAt.toISOString(), summary: input.summary })).digest('hex');
    return db.$transaction(async (tx) => {
        await assertExecutionCapabilityTx(tx, { token: input.capability,
            accountId: input.accountId, executionId: input.executionId,
            machineId: input.machineId, operation: 'event' });
        const existing = await tx.aiPersistentExecutionEvent.findUnique({ where: {
            executionId_eventId: { executionId: input.executionId, eventId: input.eventId },
        } });
        if (existing) {
            if (existing.payloadHash !== payloadHash) throw new Error('Event ID content conflict');
            return { id: existing.id, seq: existing.seq, duplicate: true };
        }
        const latest = await tx.aiPersistentExecutionEvent.findFirst({ where: {
            executionId: input.executionId }, orderBy: { seq: 'desc' }, select: { seq: true } });
        if (latest && input.seq <= latest.seq) throw new Error('Event sequence is out of order');
        const row = await tx.aiPersistentExecutionEvent.create({ data: {
            accountId: input.accountId, executionId: input.executionId,
            eventId: input.eventId, seq: input.seq, kind: input.kind,
            phase: input.phase, occurredAt: input.occurredAt,
            redactedSummary: redactExecutionSummary(input.summary), payloadHash,
        } });
        return { id: row.id, seq: row.seq, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function redactExpiredExecutionEvents(now = new Date(), accountId?: string) {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    return db.aiPersistentExecutionEvent.updateMany({ where: { createdAt: { lt: cutoff },
        redactedAt: null, ...(accountId ? { accountId } : {}) },
        data: { redactedSummary: '', redactedAt: now } });
}

export function startExecutionEventRetentionWorker() {
    forever('ai-execution-event-retention', async () => {
        await redactExpiredExecutionEvents();
        await delay(60 * 60_000, shutdownSignal);
    });
}

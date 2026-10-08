import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { assertExecutionCapabilityTx } from './workspaceAuth';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';

export class AiBudgetExceeded extends Error {
    constructor() { super('AI budget limit exceeded'); }
}

export async function reserveAiRunBudgetTx(tx: Prisma.TransactionClient, input: {
    accountId: string; projectId?: string | null; runId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const workspace = await tx.aiWorkspace.findUnique({ where: { ownerAccountId: input.accountId },
        select: { id: true } });
    if (!workspace) return null;
    const policies = await tx.aiBudgetPolicy.findMany({ where: { workspaceId: workspace.id,
        active: true, periodStart: { lte: now }, periodEnd: { gt: now },
        OR: [{ projectId: input.projectId ?? '__none__' }, { projectId: null }],
    }, orderBy: { projectId: 'desc' }, take: 2 });
    const policy = policies.find((item) => item.projectId === input.projectId) ??
        policies.find((item) => item.projectId === null);
    if (!policy) return null;
    const locked = await tx.$queryRaw<Array<{ id: string; usedMicros: bigint;
        reservedMicros: bigint; limitMicros: bigint; perRunReserveMicros: bigint;
        revision: number; active: boolean }>>`
        SELECT id, "usedMicros", "reservedMicros", "limitMicros", "perRunReserveMicros",
               revision, active FROM "AiBudgetPolicy" WHERE id=${policy.id} FOR UPDATE`;
    const current = locked[0];
    if (!current?.active || current.usedMicros + current.reservedMicros
        + current.perRunReserveMicros > current.limitMicros) throw new AiBudgetExceeded();
    await tx.aiBudgetPolicy.update({ where: { id: policy.id },
        data: { reservedMicros: { increment: current.perRunReserveMicros } } });
    await tx.aiBudgetReservation.create({ data: { policyId: policy.id,
        runId: input.runId, reserveMicros: current.perRunReserveMicros,
        policyRevision: current.revision } });
    return policy.id;
}

export async function recordAiUsageDelta(input: { accountId: string; executionId: string;
    machineId: string; capability: string; sourceEventId: string;
    provider: string; model: string; inputTokens: number; outputTokens: number;
    costMicros?: bigint | null; pricingVersion?: string | null; measuredAt: Date }) {
    const payloadHash = createHash('sha256').update(JSON.stringify({ ...input,
        capability: undefined, costMicros: input.costMicros?.toString() ?? null,
        measuredAt: input.measuredAt.toISOString() })).digest('hex');
    return db.$transaction(async (tx) => {
        await assertExecutionCapabilityTx(tx, { token: input.capability,
            accountId: input.accountId, executionId: input.executionId,
            machineId: input.machineId, operation: 'usage' });
        const existing = await tx.aiUsageDelta.findUnique({ where: { executionId_sourceEventId: {
            executionId: input.executionId, sourceEventId: input.sourceEventId,
        } } });
        if (existing) {
            if (existing.payloadHash !== payloadHash) throw new Error('Usage event content conflict');
            return { duplicate: true, id: existing.id };
        }
        const execution = await tx.orchestratorExecution.findUniqueOrThrow({ where: {
            id: input.executionId }, select: { provider: true, model: true, runId: true } });
        if (execution.provider !== input.provider || (execution.model ?? 'default') !== input.model) {
            throw new Error('Usage model does not match execution');
        }
        const row = await tx.aiUsageDelta.create({ data: { accountId: input.accountId,
            executionId: input.executionId, sourceEventId: input.sourceEventId,
            provider: input.provider, model: input.model,
            inputTokens: input.inputTokens, outputTokens: input.outputTokens,
            costMicros: input.costMicros ?? null, pricingVersion: input.pricingVersion ?? null,
            measuredAt: input.measuredAt, payloadHash } });
        const candidate = await tx.aiBudgetReservation.findUnique({ where: {
            runId: execution.runId }, select: { id: true, policyId: true } });
        if (candidate) {
            await tx.$queryRaw`SELECT id FROM "AiBudgetPolicy"
                WHERE id=${candidate.policyId} FOR UPDATE`;
            const reservation = await tx.aiBudgetReservation.findUniqueOrThrow({ where: {
                id: candidate.id } });
            if (reservation.status === 'settled') {
                if (reservation.resolutionRequestId || input.costMicros == null) {
                    throw new Error('Settled budget requires explicit cost reconciliation');
                }
                await tx.aiBudgetReservation.update({ where: { id: reservation.id },
                    data: { actualMicros: { increment: input.costMicros } } });
                await tx.aiBudgetPolicy.update({ where: { id: reservation.policyId },
                    data: { usedMicros: { increment: input.costMicros } } });
            }
        }
        return { duplicate: false, id: row.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function settleAiBudgetTick(accountId?: string) {
    const rows = await db.aiBudgetReservation.findMany({ where: { status: 'reserved',
        ...(accountId ? { policy: { workspace: { ownerAccountId: accountId } } } : {}) },
        take: 100 });
    for (const row of rows) {
        await db.$transaction(async (tx) => {
            const policy = await tx.aiBudgetPolicy.findUnique({ where: { id: row.policyId } });
            if (!policy) return;
            await tx.$queryRaw`SELECT id FROM "AiBudgetPolicy" WHERE id=${policy.id} FOR UPDATE`;
            const reservation = await tx.aiBudgetReservation.findUnique({ where: { id: row.id } });
            if (reservation?.status !== 'reserved') return;
            const run = await tx.orchestratorRun.findUnique({ where: { id: row.runId },
                select: { status: true, executions: { select: { id: true } } } });
            if (!run || !['completed', 'failed', 'cancelled'].includes(run.status)) return;
            const executionIds = run.executions.map((item) => item.id);
            const deltas = await tx.aiUsageDelta.findMany({ where: { executionId: {
                in: executionIds } }, select: { costMicros: true } });
            if (!deltas.length || deltas.some((item) => item.costMicros === null)) {
                await tx.aiBudgetReservation.update({ where: { id: row.id },
                    data: { status: 'unknown' } });
                return;
            }
            const actual = deltas.reduce((sum, item) => sum + item.costMicros!, 0n);
            await tx.aiBudgetReservation.update({ where: { id: row.id }, data: {
                status: 'settled', actualMicros: actual, settledAt: new Date() } });
            await tx.aiBudgetPolicy.update({ where: { id: policy.id }, data: {
                reservedMicros: { decrement: reservation.reserveMicros },
                usedMicros: { increment: actual },
            } });
        });
    }
}

export function startAiBudgetWorker() {
    forever('ai-budget', async () => {
        await settleAiBudgetTick();
        await delay(15_000, shutdownSignal);
    });
}

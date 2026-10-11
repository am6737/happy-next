import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TEAMMATE_BUDGET_WARNING_RATIO, TEAMMATE_TASK_ACTIVE_STATUSES } from 'happy-wire';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { channelSystemMessage } from '@/app/channel/channelSystemMessage';
import { channelTeammateDmWhere } from '@/app/channel/channelQueries';
import { teammateSpendGet } from './teammateSpend';
import { teammateNotify } from './teammateNotify';
import { teammateUpdated } from './teammateUpdated';
import { toTeammateDto, toTeammateRunDto } from './teammateQueries';
import { teammateRunTerminateTx } from './teammateRunFinish';
import { TEAMMATE_IN_FLIGHT_RUN_STATUSES } from './teammateRunStatuses';
import { teammateRunUpdated } from './teammateRunUpdated';
import { teammateRunCancelRpc, teammateTaskStopRpc } from './teammateTaskTerminate';
import { teammateTaskWake } from './teammateTaskWake';

/** Evaluate current UTC-month spend and atomically warn, pause, or resume a teammate. */
export async function teammateBudgetEvaluate(teammateId: string, now = new Date()): Promise<void> {
    const profile = await db.teammate.findUnique({ where: { id: teammateId } });
    if (!profile) return;
    const spend = await teammateSpendGet(profile.accountId, teammateId, now);
    if (!spend) return;
    await inTx(async tx => {
        const teammate = await tx.teammate.findUnique({ where: { id: teammateId } });
        if (!teammate) return;
        const budget = teammate.monthlyBudgetUsd;
        const dm = await tx.channel.findFirst({ where: channelTeammateDmWhere(teammate.accountId, teammateId), select: { id: true } });
        const month = now.toISOString().slice(0, 7);
        if (budget !== null && spend.spentUsd >= budget * TEAMMATE_BUDGET_WARNING_RATIO && spend.spentUsd < budget) {
            const localId = `system:budget_warning:${month}:${budget}`;
            if (dm && !await tx.channelMessage.findUnique({ where: { channelId_localId: { channelId: dm.id, localId } } })) {
                await channelSystemMessage(dm.id, 'budget_warning', { spentUsd: spend.spentUsd, budgetUsd: budget }, tx, localId);
                teammateNotify(tx, teammate, 'Agent budget warning', `${teammate.name} has used 80% of its monthly budget.`, { code: 'budget_warning', spentUsd: spend.spentUsd, budgetUsd: budget });
            }
        }
        if (budget !== null && spend.spentUsd >= budget && teammate.status === 'active') {
            const changed = await tx.teammate.updateMany({ where: { id: teammateId, status: 'active' }, data: { status: 'budget_paused' } });
            if (!changed.count) return;
            const updated = { ...teammate, status: 'budget_paused' };
            await teammateUpdated(tx, teammate.accountId, toTeammateDto(updated));
            const runs = await tx.teammateRun.findMany({ where: { teammateId, status: { in: TEAMMATE_IN_FLIGHT_RUN_STATUSES } } });
            for (const run of runs) {
                await teammateRunTerminateTx(tx, run.id, 'cancelled', 'budget_exceeded', now);
                teammateRunCancelRpc(tx, teammate, run, 'budget_exceeded');
            }
            const tasks = await tx.teammateTask.findMany({ where: { teammateId, status: { in: [...TEAMMATE_TASK_ACTIVE_STATUSES] } }, include: { teammate: true } });
            for (const task of tasks) teammateTaskStopRpc(tx, task, 'budget');
            // The status guard makes each transition unique; a transaction retry reuses the same `now`.
            if (dm) await channelSystemMessage(dm.id, 'budget_paused', { spentUsd: spend.spentUsd, budgetUsd: budget }, tx, `system:budget_paused:${now.getTime()}`);
            teammateNotify(tx, teammate, 'Agent budget reached', `${teammate.name} is paused until its budget increases or the month changes.`, { code: 'budget_paused', spentUsd: spend.spentUsd, budgetUsd: budget });
        }
        if (teammate.status === 'budget_paused' && (budget === null || spend.spentUsd < budget)) {
            const changed = await tx.teammate.updateMany({ where: { id: teammateId, status: 'budget_paused' }, data: { status: 'active' } });
            if (!changed.count) return;
            await teammateUpdated(tx, teammate.accountId, toTeammateDto({ ...teammate, status: 'active' }));
            const threads = await tx.teammateThread.findMany({ where: { teammateId } });
            for (const thread of threads) {
                const latest = await tx.teammateRun.findFirst({ where: { threadId: thread.id }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }] });
                if (!latest || latest.status !== 'cancelled' || latest.failureReason !== 'budget_exceeded') continue;
                if (await tx.teammateRun.count({ where: { threadId: thread.id, status: 'queued' } })) continue;
                if (thread.kind === 'task') {
                    if (!thread.taskId) continue;
                    const task = await tx.teammateTask.findUnique({ where: { id: thread.taskId } });
                    if (!task || !(TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status)) continue;
                    const events = (latest.eventPayload as { events?: Array<{ type: string; at: number; data: Record<string, unknown> }> }).events ?? [];
                    for (const event of events) await teammateTaskWake(task.id, event as Parameters<typeof teammateTaskWake>[1], { tx, trigger: 'retry' });
                } else {
                    const retry = await tx.teammateRun.create({ data: { teammateId, threadId: thread.id, trigger: 'retry', status: 'queued', attempt: 1, eventPayload: latest.eventPayload as Prisma.InputJsonValue, dispatchToken: randomUUID(), queuedAt: now }, include: { thread: true } });
                    await teammateRunUpdated(tx, teammate.accountId, toTeammateRunDto(retry));
                }
            }
            if (dm) await channelSystemMessage(dm.id, 'budget_resumed', { budgetUsd: budget }, tx, `system:budget_resumed:${now.getTime()}`);
            teammateNotify(tx, teammate, 'Agent resumed', `${teammate.name} can run again.`, { code: 'budget_resumed', budgetUsd: budget });
        }
    });
}

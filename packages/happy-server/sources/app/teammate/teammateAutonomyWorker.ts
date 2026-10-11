import { db } from '@/storage/db';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { teammateBudgetEvaluate } from './teammateBudgetEvaluate';
import { teammateHeartbeatTick } from './teammateHeartbeatTick';
import { teammateDreamingTick } from './teammateDreamingTick';
import { teammateTaskStallCheck } from './teammateTaskStallCheck';

const TEAMMATE_AUTONOMY_INTERVAL_MS = 60_000;

/** Sweep teammates independently so malformed data or a remote outage cannot stop others. */
export async function teammateAutonomyTick(now = new Date()): Promise<void> {
    const teammates = await db.teammate.findMany({ where: { status: { in: ['active', 'budget_paused'] } }, select: { id: true, status: true } });
    for (const teammate of teammates) {
        const actions = teammate.status === 'budget_paused'
            ? [teammateBudgetEvaluate]
            : [teammateHeartbeatTick, teammateDreamingTick, teammateTaskStallCheck];
        for (const action of actions) {
            try { await action(teammate.id, now); }
            catch { /* Isolate each action and teammate from the remaining sweep. */ }
        }
    }
}

/** Start the resilient 60-second autonomy loop. */
export function startTeammateAutonomyWorker(): void {
    forever('teammate-autonomy-worker', async () => {
        await teammateAutonomyTick();
        await delay(TEAMMATE_AUTONOMY_INTERVAL_MS, shutdownSignal);
    });
}

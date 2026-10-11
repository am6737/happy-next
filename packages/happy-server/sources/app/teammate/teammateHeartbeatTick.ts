import { TeammateActiveHoursSchema, TEAMMATE_RPC_RUN_DISPATCH } from 'happy-wire';
import { db } from '@/storage/db';
import { hasUserRpcMethod } from '@/app/api/socket/rpcRegistry';
import { getUserOctokit } from '@/app/github/githubApi';
import { teammateActiveHoursContains } from './teammateActiveHours';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { teammateTaskWake } from './teammateTaskWake';
import { TEAMMATE_ACTIVE_RUN_STATUSES } from './teammateRunStatuses';

/**
 * Queue due heartbeat runs and wake in_review task threads whose PR changed since the agent last looked.
 * Changes made by the review flow do not count: while a review task is open it owns the PR, and the
 * reviewer's own comments land before its verdict, so the baseline is the later of the last run and the
 * last review task update. Stalled todo/in_progress tasks are handled by teammateTaskStallCheck.
 */
export async function teammateHeartbeatTick(teammateId: string, now = new Date()): Promise<void> {
    const teammate = await db.teammate.findUnique({ where: { id: teammateId } });
    if (!teammate || teammate.status !== 'active' || teammate.heartbeatIntervalMin === null) return;
    const hours = TeammateActiveHoursSchema.safeParse(teammate.activeHours);
    if (teammate.activeHours && !hours.success) return;
    if (!teammateActiveHoursContains(hours.success ? hours.data : null, now)) return;
    if (!hasUserRpcMethod(teammate.accountId, `${teammate.machineId}:${TEAMMATE_RPC_RUN_DISPATCH}`)) return;
    const thread = await teammateThreadEnsure(teammateId, 'heartbeat');
    if (await db.teammateRun.count({ where: { threadId: thread.id, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } } })) return;
    const last = await db.teammateRun.findFirst({ where: { threadId: thread.id, trigger: 'heartbeat' }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }] });
    if (last && last.queuedAt.getTime() > now.getTime() - teammate.heartbeatIntervalMin * 60_000) return;
    const at = now.getTime();
    await teammateRunEnqueue({ teammateId, threadId: thread.id, trigger: 'heartbeat', event: { type: 'heartbeat', at, data: { scheduled: true } } });
    const tasks = await db.teammateTask.findMany({ where: { teammateId, status: 'in_review', prUrl: { not: null } }, include: { threads: true } });
    for (const task of tasks) {
        const taskThread = task.threads.find(item => item.kind === 'task');
        if (!taskThread) continue;
        const latest = await db.teammateRun.findFirst({ where: { threadId: taskThread.id }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }] });
        if (await db.teammateRun.count({ where: { threadId: taskThread.id, status: { in: TEAMMATE_ACTIVE_RUN_STATUSES } } })) continue;
        const review = await db.teammateTask.findFirst({ where: { parentTaskId: task.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
        if (review && !['done', 'cancelled'].includes(review.status)) continue;
        const match = task.prUrl!.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!match) continue;
        try {
            const octokit = await getUserOctokit(teammate.accountId);
            const result = await octokit.rest.pulls.get({ owner: match[1], repo: match[2], pull_number: Number(match[3]) });
            const updatedAt = Date.parse(result.data.updated_at);
            const seenAt = Math.max((latest?.finishedAt ?? latest?.queuedAt ?? new Date(0)).getTime(), review?.updatedAt.getTime() ?? 0);
            if (updatedAt > seenAt) {
                await teammateTaskWake(task.id, { type: 'heartbeat', at, data: { signal: 'pr_update', prUrl: task.prUrl, state: result.data.state, merged: result.data.merged, updatedAt: result.data.updated_at } });
            }
        } catch { /* GitHub failures do not block heartbeats. */ }
    }
}

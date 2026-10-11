import { TeammateActiveHoursSchema } from 'happy-wire';
import { db } from '@/storage/db';
import { hasUserRpcMethod } from '@/app/api/socket/rpcRegistry';
import { teammateLocalHour } from './teammateActiveHours';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { TeammateError } from './teammateError';

/** Queue one daily dreaming run only when local hour and recent activity qualify. */
export async function teammateDreamingTick(teammateId: string, now = new Date()): Promise<void> {
    const teammate = await db.teammate.findUnique({ where: { id: teammateId } });
    if (!teammate || teammate.status !== 'active' || teammate.dreamingHour === null) return;
    const hours = TeammateActiveHoursSchema.safeParse(teammate.activeHours);
    const timezone = teammate.timezone ?? (hours.success ? hours.data.timezone : null) ?? 'UTC';
    if (teammateLocalHour(timezone, now) !== teammate.dreamingHour) return;
    if (!hasUserRpcMethod(teammate.accountId, `${teammate.machineId}:teammate-run-dispatch`)) return;
    const thread = await teammateThreadEnsure(teammateId, 'dreaming');
    const latest = await db.teammateRun.findFirst({ where: { threadId: thread.id }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }] });
    if (latest && latest.queuedAt.getTime() > now.getTime() - 20 * 60 * 60_000) return;
    const since = latest?.queuedAt ?? new Date(now.getTime() - 24 * 60 * 60_000);
    const activity = await db.teammateRun.findFirst({ where: { teammateId, status: 'completed', finishedAt: { gt: since }, thread: { kind: { in: ['dm', 'group', 'task'] } } } });
    if (!activity) return;
    await teammateRunEnqueue({ teammateId, threadId: thread.id, trigger: 'dreaming', event: { type: 'dreaming', at: now.getTime(), data: { since: since.getTime() } } });
}

/** Manually enqueue a heartbeat or dreaming run; dreaming bypasses its activity guard. */
export async function teammateManualScheduledRun(accountId: string, teammateId: string, kind: 'heartbeat' | 'dreaming', now = new Date()) {
    const teammate = await db.teammate.findFirst({ where: { id: teammateId, accountId } });
    if (!teammate) throw new TeammateError('not_found');
    if (teammate.status === 'archived') throw new TeammateError('archived');
    const thread = await teammateThreadEnsure(teammateId, kind);
    if (kind === 'heartbeat') return teammateRunEnqueue({ teammateId, threadId: thread.id, trigger: 'heartbeat', event: { type: 'heartbeat', at: now.getTime(), data: { manual: true } } });
    const latest = await db.teammateRun.findFirst({ where: { threadId: thread.id }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }] });
    return teammateRunEnqueue({ teammateId, threadId: thread.id, trigger: 'dreaming', event: { type: 'dreaming', at: now.getTime(), data: { manual: true, since: latest?.queuedAt.getTime() ?? now.getTime() - 24 * 60 * 60_000 } } });
}

import * as privacyKit from 'privacy-kit';
import { randomUUID } from 'node:crypto';
import { TeammateRunDispatchPayloadSchema, TeammateRpcResultSchema, TEAMMATE_RPC_RUN_DISPATCH, TEAMMATE_TASK_ACTIVE_STATUSES, type TeammateRunDispatchPayload, type TeammateRunFailureReason } from 'happy-wire';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { hasUserRpcMethod, invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { getSessionTurnState } from '@/app/presence/sessionTurnRuntime';
import { channelTeammateDmWhere } from '@/app/channel/channelQueries';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { toTeammateDto, toTeammateRunDto, toTeammateTaskDto } from './teammateQueries';
import { teammateRunUpdated } from './teammateRunUpdated';
import { teammateRunTerminateTx } from './teammateRunFinish';
import { TEAMMATE_IN_FLIGHT_RUN_STATUSES } from './teammateRunStatuses';
import { teammateReviewContextFetch } from './teammateReviewContextFetch';
import { TEAMMATE_RPC_TIMEOUT_MS } from './teammateTaskTerminate';

const TEAMMATE_SCHEDULER_INTERVAL_MS = 2_000;
const TEAMMATE_OFFLINE_GRACE_MS = 10 * 60_000;
const TEAMMATE_DISPATCH_STALE_MS = 120_000;
const TEAMMATE_SESSION_STALE_MS = 5 * 60_000;
const TEAMMATE_RUNNING_TIMEOUT_MS = 4 * 60 * 60_000;

type DispatchAction = { accountId: string; machineId: string; payload: TeammateRunDispatchPayload };

/** Serializable predicate reads enforce thread serialization and teammate concurrency across schedulers. */
export async function teammateRunPick(runId: string, now = new Date()): Promise<DispatchAction | null> {
    return inTx(async (tx) => {
        const row = await tx.teammateRun.findUnique({ where: { id: runId }, include: { teammate: true, thread: true } });
        if (!row || row.status !== 'queued' || row.teammate.status !== 'active') return null;
        const task = row.thread.kind === 'task' && row.thread.taskId
            ? await tx.teammateTask.findFirst({ where: { id: row.thread.taskId, accountId: row.teammate.accountId, teammateId: row.teammateId } }) : null;
        if (row.thread.kind === 'task' && (!task || !(TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status))) return null;
        if (await tx.teammateRun.count({ where: { threadId: row.threadId, status: { in: TEAMMATE_IN_FLIGHT_RUN_STATUSES } } })) return null;
        const count = await tx.teammateRun.count({ where: { teammateId: row.teammateId, status: { in: TEAMMATE_IN_FLIGHT_RUN_STATUSES } } });
        if (count >= row.teammate.maxConcurrentRuns) return null;
        const { accountId, machineId } = row.teammate;
        if (!hasUserRpcMethod(accountId, `${machineId}:${TEAMMATE_RPC_RUN_DISPATCH}`)) {
            const machine = await tx.machine.findUnique({ where: { accountId_id: { accountId, id: machineId } }, select: { lastActiveAt: true } });
            if ((!machine || machine.lastActiveAt.getTime() < now.getTime() - TEAMMATE_OFFLINE_GRACE_MS)
                && row.queuedAt.getTime() < now.getTime() - TEAMMATE_OFFLINE_GRACE_MS) {
                await teammateRunTerminateTx(tx, runId, 'failed', 'runtime_offline', now, { status: 'queued' });
            }
            return null;
        }
        // Persist dispatch time in the opaque token: no dispatchedAt column exists in M1.
        const dispatchToken = `${now.getTime()}:${randomUUID()}`;
        let channel: TeammateRunDispatchPayload['channel'] = null;
        // Task and heartbeat threads report through the teammate's DM when one exists.
        const viaDm = row.thread.kind === 'task' || row.thread.kind === 'heartbeat';
        if (viaDm || row.thread.kind === 'dm' || row.thread.kind === 'group') {
            const stored = await tx.channel.findFirst({ where: viaDm ? channelTeammateDmWhere(accountId, row.teammateId) : { id: row.thread.channelId ?? '', accountId }, include: { members: { include: { account: true, teammate: true } } } });
            const member = stored?.members.find(m => m.memberType === 'teammate' && m.teammateId === row.teammateId);
            if ((!stored || !member) && !viaDm) {
                await teammateRunTerminateTx(tx, runId, 'failed', 'unknown', now, { status: 'queued' });
                return null;
            }
            if (stored && member) channel = {
                id: stored.id, kind: stored.kind as 'dm' | 'group', title: stored.title, brief: stored.brief,
                teammateEncryptedDataKey: privacyKit.encodeBase64(member.encryptedDataKey),
                members: stored.members.map(m => ({ memberType: m.memberType as 'user' | 'teammate', id: (m.memberType === 'user' ? m.accountId : m.teammateId)!,
                    name: m.memberType === 'user' ? m.account?.firstName || m.account?.username || 'You' : m.teammate!.name,
                    handle: m.memberType === 'user' ? null : m.teammate!.handle })),
            };
        }
        const payload = TeammateRunDispatchPayloadSchema.parse({
            runId, dispatchToken, attempt: row.attempt, teammate: toTeammateDto(row.teammate),
            thread: { id: row.thread.id, kind: row.thread.kind, channelId: row.thread.channelId, taskId: row.thread.taskId, currentSessionId: row.thread.currentSessionId, providerSessionId: null, resetAt: row.thread.resetAt?.getTime() ?? null },
            channel, task: task ? toTeammateTaskDto(task) : null,
            trigger: row.trigger, events: (row.eventPayload as { events: unknown[] }).events,
        });
        const changed = await tx.teammateRun.updateMany({ where: { id: runId, status: 'queued', dispatchToken: row.dispatchToken }, data: { status: 'dispatching', dispatchToken } });
        if (!changed.count) return null;
        await teammateRunUpdated(tx, accountId, toTeammateRunDto({ ...row, status: 'dispatching', dispatchToken }));
        return { accountId, machineId, payload };
    });
}

/** Dispatch outside transactions; late RPC failures cannot overwrite a started or cancelled run. */
export async function teammateRunDispatch(action: DispatchAction): Promise<void> {
    const claimed = await db.teammateRun.findFirst({
        where: { id: action.payload.runId, status: 'dispatching', dispatchToken: action.payload.dispatchToken },
        select: { id: true },
    });
    if (!claimed) return;
    let failure: TeammateRunFailureReason | null = null;
    let skipped = false;
    try {
        const payload = { ...action.payload, events: await teammateReviewContextFetch(action.accountId, action.payload.events) };
        const result = TeammateRpcResultSchema.parse(await invokeUserRpc(action.accountId, `${action.machineId}:${TEAMMATE_RPC_RUN_DISPATCH}`, payload, TEAMMATE_RPC_TIMEOUT_MS));
        if (!result.ok) failure = result.errorCode ?? 'unknown';
        else skipped = result.skipped === true;
    } catch { failure = 'dispatch_timeout'; }
    if (failure || skipped) {
        await inTx(async (tx) => {
            await teammateRunTerminateTx(tx, action.payload.runId, skipped ? 'completed' : 'failed', failure, new Date(), { status: 'dispatching', dispatchToken: action.payload.dispatchToken });
        });
    }
}

/** Detect durable dispatch age, dead controller sessions and four-hour running limits; retry is atomic. */
export async function teammateRunDetectStale(now = new Date()): Promise<void> {
    const rows = await db.teammateRun.findMany({ where: { status: { in: TEAMMATE_IN_FLIGHT_RUN_STATUSES } } });
    for (const row of rows) {
        let failure: 'dispatch_timeout' | 'runtime_recovery' | 'session_error' | null = null;
        if (row.status === 'dispatching') {
            const tokenTime = Number(row.dispatchToken.split(':')[0]);
            const dispatchedAt = Number.isFinite(tokenTime) ? tokenTime : row.queuedAt.getTime();
            if (dispatchedAt < now.getTime() - TEAMMATE_DISPATCH_STALE_MS) failure = 'dispatch_timeout';
        } else {
            if (row.startedAt && row.startedAt.getTime() < now.getTime() - TEAMMATE_RUNNING_TIMEOUT_MS) {
                failure = 'session_error';
            } else {
                const session = row.sessionId ? await db.session.findUnique({ where: { id: row.sessionId }, select: { active: true, lastActiveAt: true } }) : null;
                // Existing presence state covers heartbeats still awaiting the batched DB flush.
                const lastHeartbeatAt = row.sessionId ? getSessionTurnState(row.sessionId).lastHeartbeatAt : 0;
                if (!session || !session.active || Math.max(session.lastActiveAt.getTime(), lastHeartbeatAt) < now.getTime() - TEAMMATE_SESSION_STALE_MS) failure = 'runtime_recovery';
            }
        }
        if (failure) {
            await inTx(async (tx) => {
                await teammateRunTerminateTx(tx, row.id, 'failed', failure, now, { status: row.status, dispatchToken: row.dispatchToken, sessionId: row.sessionId });
            });
        }
    }
}

/** Scan oldest queued runs, send claims in parallel, then recover stale runs. */
export async function teammateRunSchedulerTick(now = new Date()): Promise<void> {
    const queued = await db.teammateRun.findMany({ where: { status: 'queued' }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    const actions: DispatchAction[] = [];
    for (const row of queued) {
        const action = await teammateRunPick(row.id, now);
        if (action) actions.push(action);
    }
    const results = await Promise.allSettled(actions.map(teammateRunDispatch));
    await teammateRunDetectStale(new Date(Math.max(now.getTime(), Date.now())));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
}

/** Start the resilient runtime worker alongside the server's other background workers. */
export function startTeammateRunScheduler(): void {
    forever('teammate-run-scheduler', async () => {
        await teammateRunSchedulerTick();
        await delay(TEAMMATE_SCHEDULER_INTERVAL_MS, shutdownSignal);
    });
}

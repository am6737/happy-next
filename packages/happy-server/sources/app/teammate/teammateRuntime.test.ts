import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { TeammateRunDispatchPayloadSchema } from 'happy-wire';
import type { Fastify } from '@/app/api/types';

const { dbMock, state, systemMessage, rpc, online } = vi.hoisted(() => {
    const state = { teammates: [] as any[], threads: [] as any[], runs: [] as any[], sessions: [] as any[], registrations: [] as any[], machine: null as any, committed: false, failCommit: false, seq: 0, channel: null as any };
    const expand = (row: any) => row ? { ...row, teammate: state.teammates.find(t => t.id === row.teammateId), thread: state.threads.find(t => t.id === row.threadId) } : null;
    const matches = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, expected]: [string, any]) => {
        if (key === 'AND') return expected.every((w: any) => matches(row, w));
        if (key === 'teammate') return matches(state.teammates.find(t => t.id === row.teammateId), expected);
        if (!row) return false;
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            if ('in' in expected) return expected.in.includes(row[key]);
            if ('not' in expected) return row[key] !== expected.not;
            if ('lt' in expected) return row[key] < expected.lt;
        }
        return row[key] === expected;
    });
    const findRun = vi.fn(async (args: any) => expand(state.runs.find(r => matches(r, args.where))));
    const dbMock = {
        channel: { findFirst: vi.fn(async () => state.channel) },
        teammate: { findUnique: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null), findFirst: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null) },
        teammateThread: {
            findFirst: vi.fn(async ({ where }: any) => state.threads.find(t => matches(t, where)) ?? null),
            create: vi.fn(async ({ data }: any) => { const row = { id: `thread_${state.threads.length + 1}`, channelId: null, taskId: null, currentSessionId: null, providerSessionId: null, lastActiveAt: new Date(), ...data }; state.threads.push(row); return row; }),
            update: vi.fn(async ({ where, data }: any) => { const row = state.threads.find(t => matches(t, where)); Object.assign(row, data); return row; }),
        },
        teammateRun: {
            findFirst: findRun, findUnique: findRun,
            findMany: vi.fn(async ({ where, orderBy }: any) => { const rows = state.runs.filter(r => matches(r, where)); if (orderBy) rows.sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime() || a.id.localeCompare(b.id)); return rows.map(expand); }),
            count: vi.fn(async ({ where }: any) => state.runs.filter(r => matches(r, where)).length),
            updateMany: vi.fn(async ({ where, data }: any) => { const rows = state.runs.filter(r => matches(r, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; }),
            update: vi.fn(async ({ where, data }: any) => { const row = state.runs.find(r => matches(r, where)); Object.assign(row, data); return expand(row); }),
            create: vi.fn(async ({ data }: any) => { const row = { id: `new_run_${state.runs.length + 1}`, queuedAt: new Date(), startedAt: null, finishedAt: null, sessionId: null, failureReason: null, taskId: null, costUsd: null, ...data }; state.runs.push(row); return expand(row); }),
        },
        teammateSession: {
            findUnique: vi.fn(async ({ where }: any) => state.registrations.find(r => matches(r, where)) ?? null),
            findMany: vi.fn(async ({ where }: any) => state.registrations.filter(r => matches(r, where))),
            upsert: vi.fn(async ({ where, create, update }: any) => { const row = state.registrations.find(r => matches(r, where)); if (row) { Object.assign(row, update); return row; } state.registrations.push(create); return create; }),
        },
        session: { findUnique: vi.fn(async ({ where }: any) => state.sessions.find(s => matches(s, where)) ?? null), findFirst: vi.fn(async ({ where }: any) => state.sessions.find(s => matches(s, where)) ?? null) },
        machine: { findUnique: vi.fn(async () => state.machine) },
        account: { update: vi.fn(async () => ({ seq: ++state.seq })) },
        $transaction: vi.fn(async (fn: any) => { state.committed = false; const result = await fn(dbMock); if (state.failCommit) throw new Error('commit failed'); state.committed = true; return result; }),
    };
    return { dbMock, state, systemMessage: vi.fn(), rpc: vi.fn(), online: vi.fn() };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/api/socket/rpcRegistry', () => ({ invokeUserRpc: rpc, hasUserRpcMethod: online }));
vi.mock('@/app/channel/channelSystemMessage', () => ({ channelSystemMessage: systemMessage }));

import { eventRouter } from '@/app/events/eventRouter';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { teammateRunStart } from './teammateRunStart';
import { teammateRunFinish } from './teammateRunFinish';
import { teammateRunComplete } from './teammateRunComplete';
import { teammateRunCancel } from './teammateRunCancel';
import { teammateRunRetry } from './teammateRunRetry';
import { teammateRunPick, teammateRunDispatch, teammateRunDetectStale, teammateRunSchedulerTick } from './teammateRunScheduler';
import { teammateOnSessionTurnEnded } from './teammateOnSessionTurnEnded';
import { teammateSessionCacheInvalidate } from './teammateSessionCache';
import { teammateActiveSessions, teammateRunGet } from './teammateRuntimeQueries';
import { teammateRoutes } from '@/app/api/routes/teammateRoutes';
import { __resetSessionTurnRuntimeForTests, updateThinkingState } from '@/app/presence/sessionTurnRuntime';

const now = new Date('2026-10-09T12:00:00.000Z');
const event = { type: 'manual' as const, at: now.getTime(), data: { note: 'Review the queue' } };
const profile = {
    id: 'mate', accountId: 'account', handle: 'atlas', name: 'Atlas', avatar: null, role: 'Engineer', skills: ['typescript'], repos: ['owner/repo'], instructions: 'Ship small changes', machineId: 'machine', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'claude', model: null, workerPermissionMode: 'default', workerProfileId: null, workerEnv: null, maxConcurrentRuns: 3, monthlyBudgetUsd: null, heartbeatIntervalMin: null, activeHours: null, dreamingHour: null, canSelfAssign: false, status: 'active', createdAt: now, updatedAt: now,
};
const thread = { resetAt: null, id: 'thread', teammateId: 'mate', kind: 'heartbeat', channelId: null, taskId: null, currentSessionId: null, providerSessionId: 'local-only', lastActiveAt: now };
function addRun(overrides: any = {}) {
    const row = { id: `run_${state.runs.length + 1}`, teammateId: 'mate', threadId: 'thread', trigger: 'manual', eventPayload: { events: [event] }, status: 'queued', attempt: 1, dispatchToken: 'secret', failureReason: null, sessionId: null, taskId: null, costUsd: null, queuedAt: now, startedAt: null, finishedAt: null, ...overrides };
    state.runs.push(row);
    return row;
}
const started = { dispatchToken: 'secret', sessionId: 'session', resumed: false, delivery: 'sent' as const };

beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
    state.teammates = [{ ...profile }]; state.threads = [{ ...thread }]; state.runs = []; state.sessions = [{ id: 'session', accountId: 'account', active: true, lastActiveAt: now }]; state.registrations = []; state.machine = { lastActiveAt: now }; state.committed = false; state.failCommit = false; state.seq = 0; state.channel = null;
    for (const id of ['session', 'ordinary', 'worker']) teammateSessionCacheInvalidate(id);
    __resetSessionTurnRuntimeForTests();
    online.mockReturnValue(true); rpc.mockResolvedValue({ ok: true });
    vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => { expect(state.committed).toBe(true); return { total: 1, sessionScoped: 0 }; });
});
afterEach(() => vi.useRealTimers());

describe('thread ensure and enqueue', () => {
    it('reuses singleton threads and creates dreaming exactly once', async () => {
        expect((await teammateThreadEnsure('mate', 'heartbeat', { taskId: 'ignored' })).id).toBe('thread');
        const first = await teammateThreadEnsure('mate', 'dreaming');
        expect((await teammateThreadEnsure('mate', 'dreaming')).id).toBe(first.id);
        expect(dbMock.teammateThread.create).toHaveBeenCalledTimes(1);
    });
    it('coalesces events in a queued run and emits after commit', async () => {
        const row = addRun();
        const run = await teammateRunEnqueue({ teammateId: 'mate', threadId: 'thread', trigger: 'manual', event: { ...event, data: { note: 'second' } } });
        expect(run.id).toBe(row.id); expect(state.runs).toHaveLength(1); expect(row.eventPayload.events).toEqual([event, { ...event, data: { note: 'second' } }]);
        expect(eventRouter.emitUpdate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'account', payload: expect.objectContaining({ body: { t: 'teammate-run-updated', run } }) }));
    });
    it('creates attempt 1 when the existing run is running', async () => {
        addRun({ status: 'running' });
        const run = await teammateRunEnqueue({ teammateId: 'mate', threadId: 'thread', trigger: 'manual', event });
        expect(state.runs).toHaveLength(2); expect(run).toMatchObject({ status: 'queued', attempt: 1 });
    });
    it('rejects archived teammates and foreign threads', async () => {
        state.teammates[0].status = 'archived';
        await expect(teammateRunEnqueue({ teammateId: 'mate', threadId: 'thread', trigger: 'manual', event })).rejects.toMatchObject({ code: 'archived' });
        state.teammates[0].status = 'active';
        await expect(teammateRunEnqueue({ teammateId: 'mate', threadId: 'other', trigger: 'manual', event })).rejects.toMatchObject({ code: 'not_found' });
        expect(dbMock.teammateRun.create).not.toHaveBeenCalled();
    });
    it.each(['paused', 'budget_paused'])('queues a %s teammate', async status => {
        state.teammates[0].status = status;
        expect((await teammateRunEnqueue({ teammateId: 'mate', threadId: 'thread', trigger: 'manual', event })).status).toBe('queued');
    });
    it('does not emit when the transaction cannot commit', async () => {
        state.failCommit = true;
        await expect(teammateRunEnqueue({ teammateId: 'mate', threadId: 'thread', trigger: 'manual', event })).rejects.toThrow('commit failed');
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
});

describe('scheduler pick and dispatch', () => {
    it.each(['dispatching', 'running'])('serializes a thread with a %s run', async status => {
        addRun({ status }); const queued = addRun();
        expect(await teammateRunPick(queued.id, now)).toBeNull(); expect(queued.status).toBe('queued');
    });
    it('limits concurrency across different threads', async () => {
        state.teammates[0].maxConcurrentRuns = 1;
        addRun({ status: 'running', threadId: 'another' }); const queued = addRun();
        expect(await teammateRunPick(queued.id, now)).toBeNull();
    });
    it.each(['paused', 'budget_paused', 'archived'])('holds a %s teammate', async status => {
        state.teammates[0].status = status; const queued = addRun();
        expect(await teammateRunPick(queued.id, now)).toBeNull(); expect(online).not.toHaveBeenCalled();
    });
    it('claims once with a full validated payload and sends the 30-second RPC', async () => {
        const queued = addRun(); const action = await teammateRunPick(queued.id, now);
        expect(action).not.toBeNull(); expect(queued.status).toBe('dispatching');
        expect(action!.payload).toEqual(TeammateRunDispatchPayloadSchema.parse(action!.payload));
        expect(action!.payload.thread.providerSessionId).toBeNull(); expect(action!.payload.events).toEqual([event]);
        expect(action!.payload.teammate).toMatchObject({ handle: 'atlas', instructions: 'Ship small changes' });
        expect(await teammateRunPick(queued.id, now)).toBeNull();
        await teammateRunDispatch(action!);
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-run-dispatch', action!.payload, 30_000);
    });
    it('completes a skipped heartbeat without a session or retry', async () => {
        const queued = addRun({ trigger: 'heartbeat' });
        const action = await teammateRunPick(queued.id, now);
        rpc.mockResolvedValueOnce({ ok: true, skipped: true });
        await teammateRunDispatch(action!);
        expect(queued).toMatchObject({ status: 'completed', failureReason: null, sessionId: null });
        expect(state.runs).toHaveLength(1);
        await teammateRunDispatch(action!);
        expect(state.runs).toHaveLength(1);
    });
    it.each(['dm', 'group'])('dispatches %s channel keys, member names and reset time', async kind => {
        Object.assign(state.threads[0], { kind, channelId: 'channel', resetAt: now });
        state.channel = { id: 'channel', kind, title: kind === 'group' ? 'Engineering' : null, members: [
            { memberType: 'user', accountId: 'account', account: { firstName: 'Ada', username: 'ada' } },
            { memberType: 'teammate', teammateId: 'mate', encryptedDataKey: new Uint8Array([1, 2]), teammate: profile },
        ] };
        const row = addRun(); const action = await teammateRunPick(row.id, now);
        expect(action!.payload.thread.resetAt).toBe(now.getTime());
        expect(action!.payload.channel).toEqual({ id: 'channel', kind, title: state.channel.title, teammateEncryptedDataKey: 'AQI=', members: [
            { memberType: 'user', id: 'account', name: 'Ada', handle: null },
            { memberType: 'teammate', id: 'mate', name: 'Atlas', handle: 'atlas' },
        ] });
        expect(TeammateRunDispatchPayloadSchema.safeParse(action!.payload).success).toBe(true);
    });
    it.each([['', 'ada', 'ada'], [null, null, 'You']])('derives user name from firstName, username and You fallback', async (firstName, username, name) => {
        Object.assign(state.threads[0], { kind: 'dm', channelId: 'channel' });
        state.channel = { id: 'channel', kind: 'dm', title: null, members: [
            { memberType: 'user', accountId: 'account', account: { firstName, username } },
            { memberType: 'teammate', teammateId: 'mate', encryptedDataKey: new Uint8Array([1]), teammate: profile },
        ] };
        const row = addRun(); expect((await teammateRunPick(row.id, now))!.payload.channel!.members[0].name).toBe(name);
    });
    it('keeps non-channel payloads nullable and fails channels missing the teammate key', async () => {
        const row = addRun(); const action = await teammateRunPick(row.id, now);
        expect(action!.payload.channel).toBeNull(); expect(action!.payload.task).toBeNull(); expect(action!.payload.thread.resetAt).toBeNull();
        row.status = 'queued'; Object.assign(state.threads[0], { kind: 'dm', channelId: 'missing' });
        expect(await teammateRunPick(row.id, now)).toBeNull();
        expect(row).toMatchObject({ status: 'failed', failureReason: 'unknown' });
    });
    it('uses conditional claims and emits nothing when another scheduler won', async () => {
        const queued = addRun(); dbMock.teammateRun.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await teammateRunPick(queued.id, now)).toBeNull(); expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
    it('a tick claims oldest first and reserves concurrency before sending', async () => {
        const late = addRun({ queuedAt: now }); const old = addRun({ queuedAt: new Date(now.getTime() - 1000) });
        await teammateRunSchedulerTick(now);
        expect(old.status).toBe('dispatching'); expect(late.status).toBe('queued'); expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('does not dispatch a claim cancelled before the RPC is sent', async () => {
        const row = addRun(); const action = await teammateRunPick(row.id, now);
        await teammateRunCancel('account', row.id); rpc.mockClear();
        await teammateRunDispatch(action!); expect(rpc).not.toHaveBeenCalled();
    });
    it('maps an RPC exception to dispatch_timeout and retries once', async () => {
        const row = addRun(); const action = await teammateRunPick(row.id, now); rpc.mockRejectedValueOnce(new Error('timeout'));
        await teammateRunDispatch(action!);
        expect(row.failureReason).toBe('dispatch_timeout'); expect(state.runs[1]).toMatchObject({ attempt: 2, trigger: 'retry' });
    });
    it('preserves RPC errorCode and does not overwrite a late started callback', async () => {
        const row = addRun(); const action = await teammateRunPick(row.id, now); rpc.mockResolvedValueOnce({ ok: false, errorCode: 'spawn_failed' });
        await teammateRunDispatch(action!); expect(row.failureReason).toBe('spawn_failed');
        const retry = state.runs[1]; const second = await teammateRunPick(retry.id, now);
        rpc.mockImplementationOnce(async () => {
            await teammateRunStart(retry.id, { ...started, dispatchToken: second!.payload.dispatchToken }, 'account');
            throw new Error('late timeout');
        });
        await teammateRunDispatch(second!);
        expect(retry.status).toBe('running'); expect(state.runs).toHaveLength(2);
    });
});

describe('offline grace', () => {
    it.each([[1, 11], [11, 1], [10, 11]])('holds when machine age=%i and run age=%i minutes', async (machineAge, runAge) => {
        online.mockReturnValue(false); state.machine.lastActiveAt = new Date(now.getTime() - machineAge * 60_000);
        const row = addRun({ queuedAt: new Date(now.getTime() - runAge * 60_000) });
        expect(await teammateRunPick(row.id, now)).toBeNull(); expect(row.status).toBe('queued');
    });
    it('fails only when both are older than ten minutes, without retry', async () => {
        online.mockReturnValue(false); state.machine.lastActiveAt = new Date(now.getTime() - 11 * 60_000);
        const row = addRun({ queuedAt: new Date(now.getTime() - 11 * 60_000) });
        await teammateRunPick(row.id, now);
        expect(row).toMatchObject({ status: 'failed', failureReason: 'runtime_offline', finishedAt: now }); expect(state.runs).toHaveLength(1); expect(rpc).not.toHaveBeenCalled();
    });
});

describe('stale detection and retry', () => {
    it('dispatch timeout retries with identical events and attempt 2, never attempt 3', async () => {
        const row = addRun({ status: 'dispatching', dispatchToken: `${now.getTime() - 121_000}:first` });
        await teammateRunDetectStale(now);
        expect(row).toMatchObject({ status: 'failed', failureReason: 'dispatch_timeout' });
        const retry = state.runs[1]; expect(retry).toMatchObject({ trigger: 'retry', status: 'queued', attempt: 2, eventPayload: row.eventPayload });
        retry.status = 'dispatching'; retry.dispatchToken = `${now.getTime() - 121_000}:second`;
        await teammateRunDetectStale(now); await teammateRunDetectStale(now);
        expect(retry.status).toBe('failed'); expect(state.runs).toHaveLength(2);
    });
    it('counts stale time from dispatch rather than the original queue time', async () => {
        const row = addRun({ status: 'dispatching', queuedAt: new Date(now.getTime() - 3_600_000), dispatchToken: `${now.getTime()}:new` });
        await teammateRunDetectStale(now); expect(row.status).toBe('dispatching');
    });
    it.each(['inactive', 'old', 'missing'])('recovers a running run with an %s session', async mode => {
        const row = addRun({ status: 'running', sessionId: 'session', startedAt: now });
        if (mode === 'inactive') state.sessions[0].active = false;
        if (mode === 'old') state.sessions[0].lastActiveAt = new Date(now.getTime() - 301_000);
        if (mode === 'missing') state.sessions = [];
        await teammateRunDetectStale(now); expect(row.failureReason).toBe('runtime_recovery'); expect(state.runs[1].attempt).toBe(2);
    });
    it('uses existing presence heartbeats waiting for DB flush', async () => {
        const row = addRun({ status: 'running', sessionId: 'session', startedAt: now });
        state.sessions[0].lastActiveAt = new Date(now.getTime() - 301_000); updateThinkingState('session', true, now.getTime());
        await teammateRunDetectStale(now); expect(row.status).toBe('running');
    });
    it('fails a four-hour run with session_error without retry', async () => {
        const row = addRun({ status: 'running', sessionId: 'session', startedAt: new Date(now.getTime() - 4 * 3_600_000 - 1) });
        await teammateRunDetectStale(now); expect(row.failureReason).toBe('session_error'); expect(state.runs).toHaveLength(1);
    });
});

describe('callbacks and completion', () => {
    it('rejects token mismatches and account mismatches before mutation', async () => {
        const row = addRun({ status: 'dispatching' });
        await expect(teammateRunStart(row.id, { ...started, dispatchToken: 'bad' }, 'account')).rejects.toMatchObject({ code: 'invalid_token' });
        await expect(teammateRunFinish(row.id, { dispatchToken: 'bad', status: 'failed' }, 'account')).rejects.toMatchObject({ code: 'invalid_token' });
        await expect(teammateRunStart(row.id, started, 'other')).rejects.toMatchObject({ code: 'not_found' });
        expect(dbMock.teammateRun.updateMany).not.toHaveBeenCalled();
    });
    it('started upserts a controller, mirrors the thread and preserves startedAt on repeat', async () => {
        const row = addRun({ status: 'dispatching' });
        await teammateRunStart(row.id, started, 'account');
        expect(row).toMatchObject({ status: 'running', startedAt: now, sessionId: 'session' });
        expect(state.registrations).toEqual([{ sessionId: 'session', teammateId: 'mate', threadId: 'thread', role: 'controller', taskId: null }]);
        expect(state.threads[0]).toMatchObject({ currentSessionId: 'session', lastActiveAt: now });
        vi.advanceTimersByTime(1000); await teammateRunStart(row.id, started, 'account');
        expect(row.startedAt).toEqual(now); expect(dbMock.teammateSession.upsert).toHaveBeenCalledTimes(1); expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(1);
    });
    it('rejects a controller session owned by another account', async () => {
        const row = addRun({ status: 'dispatching' }); state.sessions[0].accountId = 'other';
        await expect(teammateRunStart(row.id, started, 'account')).rejects.toMatchObject({ code: 'not_found' }); expect(row.status).toBe('dispatching');
    });
    it.each(['completed', 'failed', 'cancelled'])('finished on a %s run is a no-op', async status => {
        const row = addRun({ status }); await teammateRunFinish(row.id, { dispatchToken: 'secret', status: 'failed', failureReason: 'spawn_failed' }, 'account');
        expect(row.status).toBe(status); expect(dbMock.teammateRun.updateMany).not.toHaveBeenCalled(); expect(state.runs).toHaveLength(1);
    });
    it('a repeated retryable failure creates only one new run', async () => {
        const row = addRun({ status: 'running' }); const req = { dispatchToken: 'secret', status: 'failed' as const, failureReason: 'spawn_failed' as const };
        await teammateRunFinish(row.id, req, 'account'); await teammateRunFinish(row.id, req, 'account');
        expect(state.runs).toHaveLength(2); expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(2);
    });
    it('complete ignores queued runs and cancelled runs', async () => {
        const row = addRun(); await teammateRunComplete(row.id); expect(row.status).toBe('queued');
        row.status = 'cancelled'; await teammateRunComplete(row.id); expect(row.status).toBe('cancelled'); expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
});

describe('failure notice and owner retry', () => {
    const onChannel = () => Object.assign(state.threads[0], { kind: 'dm', channelId: 'channel' });
    const finish = (runId: string, failureReason: any) => teammateRunFinish(runId, { dispatchToken: 'secret', status: 'failed', failureReason }, 'account');
    it('announces a non-retried failure once, keyed by run', async () => {
        onChannel(); const row = addRun({ status: 'running' });
        await finish(row.id, 'session_error'); await finish(row.id, 'session_error');
        expect(systemMessage).toHaveBeenCalledTimes(1);
        expect(systemMessage).toHaveBeenCalledWith('channel', 'run_failed', { runId: row.id, teammateId: 'mate', name: 'Atlas', reason: 'session_error' }, dbMock, `system:run_failed:${row.id}`);
    });
    it('announces when the automatic retry is exhausted', async () => {
        onChannel(); const row = addRun({ status: 'running', attempt: 2 });
        await finish(row.id, 'spawn_failed');
        expect(systemMessage).toHaveBeenCalledTimes(1); expect(state.runs).toHaveLength(1);
    });
    it.each(['cancelled_by_user', 'budget_exceeded'])('stays silent for %s', async reason => {
        onChannel(); await finish(addRun({ status: 'running' }).id, reason); expect(systemMessage).not.toHaveBeenCalled();
    });
    it('stays silent while retrying automatically and on threads without a channel', async () => {
        await finish(addRun({ status: 'running' }).id, 'session_error');
        onChannel(); await finish(addRun({ status: 'running' }).id, 'spawn_failed');
        expect(systemMessage).not.toHaveBeenCalled();
    });
    it('retries a failed run as a fresh attempt and is idempotent', async () => {
        const row = addRun({ status: 'failed', attempt: 2, failureReason: 'spawn_failed', finishedAt: now });
        const run = await teammateRunRetry('account', row.id);
        expect(run).toMatchObject({ status: 'queued', attempt: 1, trigger: 'retry' }); expect(state.runs).toHaveLength(2);
        expect((await teammateRunRetry('account', row.id)).id).toBe(run.id); expect(state.runs).toHaveLength(2);
    });
    it('folds retried events into a run already queued on the thread', async () => {
        const row = addRun({ status: 'failed', failureReason: 'session_error', finishedAt: now, queuedAt: new Date(now.getTime() - 1000) });
        const second = { ...event, data: { note: 'later' } };
        const queued = addRun({ eventPayload: { events: [second] }, queuedAt: new Date(now.getTime() - 500) });
        expect((await teammateRunRetry('account', row.id)).id).toBe(queued.id);
        expect(queued.eventPayload).toEqual({ events: [second, event] }); expect(state.runs).toHaveLength(2);
        await teammateRunRetry('account', row.id); expect(queued.eventPayload).toEqual({ events: [second, event] });
    });
    it('rejects runs that are not failed, foreign or archived', async () => {
        await expect(teammateRunRetry('account', addRun({ status: 'completed' }).id)).rejects.toMatchObject({ code: 'invalid_request' });
        const row = addRun({ status: 'failed', finishedAt: now });
        await expect(teammateRunRetry('other', row.id)).rejects.toMatchObject({ code: 'not_found' });
        state.teammates[0].status = 'archived';
        await expect(teammateRunRetry('account', row.id)).rejects.toMatchObject({ code: 'archived' });
    });
});

describe('turn-end hook cache', () => {
    it('completes a controller running run once', async () => {
        const row = addRun({ status: 'running', sessionId: 'session' });
        state.registrations.push({ sessionId: 'session', teammateId: 'mate', threadId: 'thread', role: 'controller' });
        await teammateOnSessionTurnEnded('session'); await teammateOnSessionTurnEnded('session');
        expect(row.status).toBe('completed'); expect(dbMock.teammateSession.findUnique).toHaveBeenCalledTimes(1); expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(1);
    });
    it('negative cache avoids the second query and expires after sixty seconds', async () => {
        await teammateOnSessionTurnEnded('ordinary'); await teammateOnSessionTurnEnded('ordinary');
        expect(dbMock.teammateSession.findUnique).toHaveBeenCalledTimes(1); expect(dbMock.teammateRun.findMany).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60_001); await teammateOnSessionTurnEnded('ordinary'); expect(dbMock.teammateSession.findUnique).toHaveBeenCalledTimes(2);
    });
    it('started invalidates a negative cached controller lookup', async () => {
        await teammateOnSessionTurnEnded('session'); const row = addRun({ status: 'dispatching' });
        await teammateRunStart(row.id, started, 'account'); await teammateOnSessionTurnEnded('session');
        expect(row.status).toBe('completed'); expect(dbMock.teammateSession.findUnique).toHaveBeenCalledTimes(2);
    });
    it('ignores worker registrations without a task', async () => {
        state.registrations.push({ sessionId: 'worker', teammateId: 'mate', threadId: 'thread', role: 'worker' });
        await teammateOnSessionTurnEnded('worker'); expect(dbMock.teammateRun.findMany).not.toHaveBeenCalled();
    });
});

describe('cancel and runtime queries', () => {
    it('cancels a queued run without RPC, idempotently', async () => {
        const row = addRun(); await teammateRunCancel('account', row.id); await teammateRunCancel('account', row.id);
        expect(row.status).toBe('cancelled'); expect(rpc).not.toHaveBeenCalled(); expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(1);
    });
    it.each(['dispatching', 'running'])('commits cancellation of a %s run before attempting RPC', async status => {
        const row = addRun({ status }); rpc.mockImplementationOnce(async () => { expect(state.committed).toBe(true); expect(row.status).toBe('cancelled'); throw new Error('offline'); });
        expect((await teammateRunCancel('account', row.id)).status).toBe('cancelled');
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-run-cancel', { runId: row.id, dispatchToken: 'secret', reason: 'cancelled_by_user' }, 30_000);
        await teammateRunCancel('account', row.id); expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('does not disclose another account run', async () => {
        const row = addRun(); await expect(teammateRunCancel('other', row.id)).rejects.toMatchObject({ code: 'not_found' }); expect(await teammateRunGet('other', row.id)).toBeNull();
    });
    it('active sessions include controllers only on this account and machine', async () => {
        addRun({ status: 'running', sessionId: 'session' }); addRun({ status: 'running', sessionId: 'worker' }); addRun({ status: 'completed', sessionId: 'old' });
        state.registrations = [{ sessionId: 'session', teammateId: 'mate', role: 'controller' }, { sessionId: 'worker', teammateId: 'mate', role: 'worker' }, { sessionId: 'old', teammateId: 'mate', role: 'controller' }];
        expect(await teammateActiveSessions('account', 'machine')).toEqual(['session']); expect(await teammateActiveSessions('other', 'machine')).toEqual([]); expect(await teammateActiveSessions('account', 'other')).toEqual([]);
    });
    it('protects the existing thread controller while a run is dispatching before started', async () => {
        state.threads[0].currentSessionId = 'session';
        addRun({ status: 'dispatching', sessionId: null });
        state.registrations = [{ sessionId: 'session', teammateId: 'mate', role: 'controller' }];
        expect(await teammateActiveSessions('account', 'machine')).toEqual(['session']);
    });
    it('returns runs without exposing dispatch secrets', async () => {
        const row = addRun(); const run = (await teammateRunGet('account', row.id))!;
        expect(run).not.toHaveProperty('dispatchToken'); expect(run).not.toHaveProperty('eventPayload');
    });
});

describe('runtime routes', () => {
    let app: ReturnType<typeof fastify>;
    beforeEach(async () => {
        vi.useRealTimers();
        app = fastify().withTypeProvider<ZodTypeProvider>(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => { if (request.headers.authorization !== 'Bearer account') return reply.code(401).send({ error: 'unauthorized' }); (request as FastifyRequest & { userId: string }).userId = 'account'; });
        teammateRoutes(app as unknown as Fastify); await app.ready();
    });
    afterEach(async () => { await app.close(); });
    const headers = { authorization: 'Bearer account' };
    it('manual run uses a heartbeat thread with note event data; archived returns 409', async () => {
        const response = await app.inject({ method: 'POST', url: '/v1/teammates/mate/runs', headers, payload: { note: 'hello' } });
        expect(response.statusCode).toBe(200); expect(response.json().run).toMatchObject({ status: 'queued', threadKind: 'heartbeat', trigger: 'manual' }); expect(state.runs[0].eventPayload.events[0].data).toEqual({ note: 'hello' });
        state.teammates[0].status = 'archived'; const archived = await app.inject({ method: 'POST', url: '/v1/teammates/mate/runs', headers, payload: {} }); expect(archived.statusCode).toBe(409); expect(archived.json()).toEqual({ error: 'archived' });
    });
    it('enqueues manual heartbeat and dreaming, with owner scope and archived guard', async () => {
        const heartbeat = await app.inject({ method: 'POST', url: '/v1/teammates/mate/heartbeat', headers });
        expect(heartbeat.statusCode).toBe(200);
        expect(state.runs[0].eventPayload.events[0]).toMatchObject({ type: 'heartbeat', data: { manual: true } });
        const dreaming = await app.inject({ method: 'POST', url: '/v1/teammates/mate/dreaming', headers });
        expect(dreaming.statusCode).toBe(200);
        expect(state.runs[1].eventPayload.events[0]).toMatchObject({ type: 'dreaming', data: { manual: true } });
        expect((await app.inject({ method: 'POST', url: '/v1/teammates/other/heartbeat', headers })).statusCode).toBe(404);
        state.teammates[0].status = 'archived';
        expect((await app.inject({ method: 'POST', url: '/v1/teammates/mate/dreaming', headers })).json()).toEqual({ error: 'archived' });
    });
    it.each(['started', 'finished'])('%s callback rejects mismatch with 403 invalid_token', async callback => {
        const row = addRun({ status: 'dispatching' }); const payload = callback === 'started' ? { ...started, dispatchToken: 'bad' } : { status: 'failed', dispatchToken: 'bad' };
        const response = await app.inject({ method: 'POST', url: `/v1/teammate-runs/${row.id}/${callback}`, headers, payload }); expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'invalid_token' });
    });
    it('serves start, finish, get, cancel and active-sessions responses', async () => {
        const row = addRun({ status: 'dispatching' });
        expect((await app.inject({ method: 'POST', url: `/v1/teammate-runs/${row.id}/started`, headers, payload: started })).json()).toEqual({ ok: true });
        expect((await app.inject({ method: 'GET', url: '/v1/teammate-runtime/active-sessions?machineId=machine', headers })).json()).toEqual({ sessionIds: ['session'] });
        expect((await app.inject({ method: 'GET', url: `/v1/teammate-runs/${row.id}`, headers })).json().run.status).toBe('running');
        expect((await app.inject({ method: 'POST', url: `/v1/teammate-runs/${row.id}/cancel`, headers })).json().run.status).toBe('cancelled');
        expect((await app.inject({ method: 'POST', url: `/v1/teammate-runs/${row.id}/finished`, headers, payload: { dispatchToken: 'secret', status: 'failed' } })).json()).toEqual({ ok: true }); expect(row.status).toBe('cancelled');
    });
    it.each([
        ['POST', '/v1/teammates/mate/runs'], ['POST', '/v1/teammate-runs/run_1/cancel'], ['GET', '/v1/teammate-runs/run_1'], ['POST', '/v1/teammate-runs/run_1/started'], ['POST', '/v1/teammate-runs/run_1/finished'], ['GET', '/v1/teammate-runtime/active-sessions?machineId=machine'],
    ] as const)('requires user authentication for %s %s', async (method, url) => {
        const payload = url.endsWith('/started') ? started : url.endsWith('/finished') ? { dispatchToken: 'secret', status: 'failed' } : url.endsWith('/runs') ? {} : undefined;
        const response = await app.inject({ method, url, payload }); expect(response.statusCode).toBe(401);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, dbMock, tx, spend, notify, message, updated, terminate, stop, wake, rpc } = vi.hoisted(() => {
    const state = { teammate: null as any, spend: 0, budget: 100, dm: { id: 'dm' } as any, warning: null as any, runs: [] as any[], tasks: [] as any[], threads: [] as any[] };
    const tx = {
        teammate: {
            findUnique: vi.fn(async () => state.teammate),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (state.teammate.status !== where.status) return { count: 0 };
                Object.assign(state.teammate, data);
                return { count: 1 };
            }),
        },
        channel: { findFirst: vi.fn(async () => state.dm) },
        channelMessage: { findUnique: vi.fn(async () => state.warning) },
        teammateRun: {
            findMany: vi.fn(async () => state.runs.filter(run => ['dispatching', 'running'].includes(run.status))),
            findFirst: vi.fn(async ({ where }: any) => state.runs.find(run => run.threadId === where.threadId) ?? null),
            count: vi.fn(async () => 0),
            create: vi.fn(async ({ data }: any) => ({ ...data, id: 'retry', thread: state.threads.find(thread => thread.id === data.threadId), queuedAt: new Date(), startedAt: null, finishedAt: null })),
        },
        teammateThread: { findMany: vi.fn(async () => state.threads) },
        teammateTask: { findMany: vi.fn(async () => state.tasks), findUnique: vi.fn(async ({ where }: any) => state.tasks.find(task => task.id === where.id) ?? null) },
    };
    return { state, tx, dbMock: { teammate: { findUnique: vi.fn(async () => state.teammate) } }, spend: vi.fn(), notify: vi.fn(), message: vi.fn(), updated: vi.fn(), terminate: vi.fn(), stop: vi.fn(), wake: vi.fn(), rpc: vi.fn() };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({ inTx: (fn: any) => fn(tx), afterTx: (_tx: any, fn: any) => fn() }));
vi.mock('@/app/api/socket/rpcRegistry', () => ({ invokeUserRpc: rpc }));
vi.mock('@/app/channel/channelSystemMessage', () => ({ channelSystemMessage: message }));
vi.mock('./teammateSpend', () => ({ teammateSpendGet: spend }));
vi.mock('./teammateNotify', () => ({ teammateNotify: notify }));
vi.mock('./teammateUpdated', () => ({ teammateUpdated: updated }));
vi.mock('./teammateQueries', () => ({ toTeammateDto: (row: any) => row, toTeammateRunDto: (row: any) => row }));
vi.mock('./teammateRunFinish', () => ({ teammateRunTerminateTx: terminate }));
vi.mock('./teammateRunUpdated', () => ({ teammateRunUpdated: vi.fn() }));
vi.mock('./teammateTaskTerminate', async (importOriginal) => ({ ...await importOriginal<typeof import('./teammateTaskTerminate')>(), teammateTaskStopRpc: stop }));
vi.mock('./teammateTaskWake', () => ({ teammateTaskWake: wake }));

import { teammateBudgetEvaluate } from './teammateBudgetEvaluate';

const now = new Date('2026-10-09T12:00:00Z');
beforeEach(() => {
    vi.clearAllMocks();
    state.teammate = { id: 'mate', accountId: 'account', machineId: 'machine', name: 'Atlas', status: 'active', monthlyBudgetUsd: 100 };
    state.dm = { id: 'dm' }; state.warning = null; state.runs = []; state.tasks = []; state.threads = [];
    spend.mockImplementation(async () => ({ spentUsd: state.spend, budgetUsd: state.budget }));
    rpc.mockResolvedValue({ ok: true });
});

describe('budget evaluation', () => {
    it('warns once per month and budget value', async () => {
        state.spend = 80;
        await teammateBudgetEvaluate('mate', now);
        expect(message).toHaveBeenCalledWith('dm', 'budget_warning', { spentUsd: 80, budgetUsd: 100 }, tx, 'system:budget_warning:2026-10:100');
        expect(notify).toHaveBeenCalledTimes(1);
        state.warning = { id: 'existing' };
        await teammateBudgetEvaluate('mate', now);
        expect(message).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('pauses in-flight runs, leaves queued runs, and stops active tasks', async () => {
        state.spend = 100;
        state.runs = [{ id: 'running', status: 'running', dispatchToken: 'token' }, { id: 'queued', status: 'queued' }];
        state.tasks = [{ id: 'task', teammateId: 'mate', status: 'in_progress' }];
        await teammateBudgetEvaluate('mate', now);
        expect(state.teammate.status).toBe('budget_paused');
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(terminate).toHaveBeenCalledWith(tx, 'running', 'cancelled', 'budget_exceeded', now);
        expect(stop).toHaveBeenCalledWith(tx, state.tasks[0], 'budget');
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-run-cancel', expect.objectContaining({ runId: 'running' }), 30_000);
        await teammateBudgetEvaluate('mate', now);
        expect(terminate).toHaveBeenCalledTimes(1);
    });

    it('resumes cancelled threads on month rollover and does not override a user pause', async () => {
        state.teammate.status = 'budget_paused'; state.spend = 0;
        state.threads = [{ id: 'thread', kind: 'heartbeat' }];
        state.runs = [{ threadId: 'thread', status: 'cancelled', failureReason: 'budget_exceeded', eventPayload: { events: [] } }];
        await teammateBudgetEvaluate('mate', new Date('2026-11-01T12:00:00Z'));
        expect(state.teammate.status).toBe('active');
        expect(tx.teammateRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trigger: 'retry', threadId: 'thread' }) }));
        expect(updated).toHaveBeenCalled();
        state.teammate.status = 'paused'; state.spend = 200;
        await teammateBudgetEvaluate('mate', now);
        expect(state.teammate.status).toBe('paused');
    });
});

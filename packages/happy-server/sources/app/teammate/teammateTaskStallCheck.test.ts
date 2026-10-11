import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, tx, busy, wake, notify, updated } = vi.hoisted(() => ({
    dbMock: {
        teammateTask: { findMany: vi.fn() },
        teammateRun: { findMany: vi.fn() },
        teammateSession: { findMany: vi.fn() },
    },
    tx: { teammateTask: { findUnique: vi.fn(), update: vi.fn() } },
    busy: vi.fn(), wake: vi.fn(), notify: vi.fn(), updated: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({ inTx: (fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock('@/app/presence/sessionTurnRuntime', () => ({ isSessionBusy: busy }));
vi.mock('./teammateTaskWake', () => ({ teammateTaskWake: wake }));
vi.mock('./teammateTaskHandoffNotify', () => ({ teammateTaskHandoffNotify: notify }));
vi.mock('./teammateTaskUpdated', () => ({ teammateTaskUpdated: updated }));
vi.mock('./teammateQueries', () => ({ toTeammateTaskDto: (row: unknown) => row }));

import { teammateTaskStallCheck } from './teammateTaskStallCheck';

const now = new Date('2026-10-09T12:00:00Z');
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
const task = { id: 'task', accountId: 'account', status: 'in_progress', threads: [{ id: 'thread', kind: 'task' }] };
const run = (over: Record<string, unknown> = {}) => ({ status: 'completed', trigger: 'work-session-idle', failureReason: null, finishedAt: minutesAgo(6), eventPayload: { events: [{ type: 'work-session-idle', data: {} }] }, ...over });
const stallWake = (over: Record<string, unknown> = {}) => run({ trigger: 'heartbeat', eventPayload: { events: [{ type: 'heartbeat', data: { signal: 'stalled' } }] }, ...over });

beforeEach(() => {
    vi.clearAllMocks();
    dbMock.teammateTask.findMany.mockResolvedValue([task]);
    dbMock.teammateRun.findMany.mockResolvedValue([run()]);
    dbMock.teammateSession.findMany.mockResolvedValue([{ sessionId: 'worker' }]);
    busy.mockReturnValue(false);
    tx.teammateTask.findUnique.mockResolvedValue(task);
    tx.teammateTask.update.mockImplementation(async ({ data }: any) => ({ ...task, ...data }));
});

describe('task stall check', () => {
    it('wakes a todo/in_progress task whose controller ended its turn with no worker running', async () => {
        await teammateTaskStallCheck('mate', now);
        expect(dbMock.teammateTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teammateId: 'mate', status: { in: ['todo', 'in_progress'] } } }));
        expect(wake).toHaveBeenCalledWith('task', { type: 'heartbeat', at: now.getTime(), data: { signal: 'stalled', failureReason: null, status: 'in_progress' } });
    });

    it('waits while a run is active, the last run is recent, or a worker is busy', async () => {
        dbMock.teammateRun.findMany.mockResolvedValue([run({ status: 'queued', finishedAt: null })]);
        await teammateTaskStallCheck('mate', now);
        dbMock.teammateRun.findMany.mockResolvedValue([run({ finishedAt: minutesAgo(2) })]);
        await teammateTaskStallCheck('mate', now);
        dbMock.teammateRun.findMany.mockResolvedValue([run({ status: 'failed', failureReason: 'session_error', finishedAt: minutesAgo(6) })]);
        await teammateTaskStallCheck('mate', now);
        dbMock.teammateRun.findMany.mockResolvedValue([run({ status: 'failed', failureReason: 'cancelled_by_user', finishedAt: minutesAgo(60) })]);
        await teammateTaskStallCheck('mate', now);
        dbMock.teammateRun.findMany.mockResolvedValue([run()]);
        busy.mockReturnValue(true);
        await teammateTaskStallCheck('mate', now);
        expect(wake).not.toHaveBeenCalled();
    });

    it('wakes failed tasks after the longer delay with the failure reason', async () => {
        dbMock.teammateRun.findMany.mockResolvedValue([run({ status: 'failed', failureReason: 'session_error', finishedAt: minutesAgo(11) })]);
        await teammateTaskStallCheck('mate', now);
        expect(wake).toHaveBeenCalledWith('task', expect.objectContaining({ data: expect.objectContaining({ signal: 'stalled', failureReason: 'session_error' }) }));
    });

    it('reminds twice in a row, then pauses the task and notifies the creator', async () => {
        dbMock.teammateRun.findMany.mockResolvedValue([stallWake(), run()]);
        await teammateTaskStallCheck('mate', now);
        expect(wake).toHaveBeenCalledTimes(1);
        expect(tx.teammateTask.update).not.toHaveBeenCalled();

        wake.mockClear();
        dbMock.teammateRun.findMany.mockResolvedValue([stallWake(), stallWake(), run()]);
        await teammateTaskStallCheck('mate', now);
        expect(wake).not.toHaveBeenCalled();
        expect(tx.teammateTask.update).toHaveBeenCalledWith({ where: { id: 'task' }, data: { status: 'paused', summary: 'Stalled: no progress after repeated reminders' } });
        expect(notify).toHaveBeenCalledWith(tx, task, expect.objectContaining({ status: 'paused' }), 'system');
        expect(updated).toHaveBeenCalled();
    });

    it('does not pause a task that changed status meanwhile', async () => {
        dbMock.teammateRun.findMany.mockResolvedValue([stallWake(), stallWake()]);
        tx.teammateTask.findUnique.mockResolvedValue({ ...task, status: 'in_review' });
        await teammateTaskStallCheck('mate', now);
        expect(tx.teammateTask.update).not.toHaveBeenCalled();
    });
});

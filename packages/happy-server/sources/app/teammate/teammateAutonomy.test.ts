import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, online, enqueue, wake, octokit } = vi.hoisted(() => ({
    dbMock: {
        teammate: { findUnique: vi.fn(), findFirst: vi.fn() },
        teammateThread: { findFirst: vi.fn() },
        teammateRun: { count: vi.fn(), findFirst: vi.fn() },
        teammateTask: { findMany: vi.fn(), findFirst: vi.fn() },
    },
    online: vi.fn(), enqueue: vi.fn(), wake: vi.fn(), octokit: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/api/socket/rpcRegistry', () => ({ hasUserRpcMethod: online }));
vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: octokit }));
vi.mock('./teammateThreadEnsure', () => ({ teammateThreadEnsure: vi.fn(async () => ({ id: 'heartbeat-thread' })) }));
vi.mock('./teammateRunEnqueue', () => ({ teammateRunEnqueue: enqueue }));
vi.mock('./teammateTaskWake', () => ({ teammateTaskWake: wake }));

import { teammateHeartbeatTick } from './teammateHeartbeatTick';
import { teammateDreamingTick, teammateManualScheduledRun } from './teammateDreamingTick';

const now = new Date('2026-10-09T12:00:00Z');
const profile = { id: 'mate', accountId: 'account', machineId: 'machine', status: 'active', heartbeatIntervalMin: 30, activeHours: null, dreamingHour: 12, timezone: 'UTC' };

beforeEach(() => {
    vi.clearAllMocks();
    dbMock.teammate.findUnique.mockResolvedValue({ ...profile });
    dbMock.teammate.findFirst.mockResolvedValue({ ...profile });
    dbMock.teammateRun.count.mockResolvedValue(0);
    dbMock.teammateRun.findFirst.mockResolvedValue(null);
    dbMock.teammateTask.findMany.mockResolvedValue([]);
    dbMock.teammateTask.findFirst.mockResolvedValue(null);
    online.mockReturnValue(true);
    enqueue.mockResolvedValue({ id: 'run' });
});

describe('heartbeat tick', () => {
    it('queues only when due and online', async () => {
        await teammateHeartbeatTick('mate', now);
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'heartbeat', event: { type: 'heartbeat', at: now.getTime(), data: { scheduled: true } } }));
        enqueue.mockClear(); online.mockReturnValue(false);
        await teammateHeartbeatTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
        online.mockReturnValue(true); dbMock.teammateRun.count.mockResolvedValue(1);
        await teammateHeartbeatTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('respects last heartbeat and active hours', async () => {
        dbMock.teammateRun.findFirst.mockResolvedValue({ queuedAt: new Date(now.getTime() - 10 * 60_000) });
        await teammateHeartbeatTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
        dbMock.teammate.findUnique.mockResolvedValue({ ...profile, activeHours: { start: '13:00', end: '14:00', timezone: 'UTC' } });
        await teammateHeartbeatTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('routes PR updates to task wake once', async () => {
        const pr = { id: 'pr-task', status: 'in_review', prUrl: 'https://github.com/acme/repo/pull/3', threads: [{ id: 'pr-thread', kind: 'task' }] };
        dbMock.teammateTask.findMany.mockResolvedValue([pr]);
        dbMock.teammateRun.findFirst.mockImplementation(async ({ where }: any) => where.threadId === 'pr-thread'
            ? { queuedAt: new Date('2026-10-09T10:00:00Z'), finishedAt: new Date('2026-10-09T10:30:00Z') } : null);
        octokit.mockResolvedValue({ rest: { pulls: { get: vi.fn().mockResolvedValue({ data: { updated_at: '2026-10-09T11:00:00Z', state: 'open', merged: false } }) } } });
        await teammateHeartbeatTick('mate', now);
        expect(dbMock.teammateTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teammateId: 'mate', status: 'in_review', prUrl: { not: null } } }));
        expect(wake).toHaveBeenCalledWith('pr-task', expect.objectContaining({ data: expect.objectContaining({ signal: 'pr_update' }) }));
        wake.mockClear();
        dbMock.teammateRun.count.mockImplementation(async ({ where }: any) => where.threadId === 'heartbeat-thread' ? 0 : 1);
        await teammateHeartbeatTick('mate', now);
        expect(wake).not.toHaveBeenCalled();
    });

    it('ignores PR updates made by the review flow', async () => {
        const pr = { id: 'pr-task', status: 'in_review', prUrl: 'https://github.com/acme/repo/pull/3', threads: [{ id: 'pr-thread', kind: 'task' }] };
        dbMock.teammateTask.findMany.mockResolvedValue([pr]);
        dbMock.teammateRun.findFirst.mockImplementation(async ({ where }: any) => where.threadId === 'pr-thread'
            ? { queuedAt: new Date('2026-10-09T10:00:00Z'), finishedAt: new Date('2026-10-09T10:30:00Z') } : null);
        octokit.mockResolvedValue({ rest: { pulls: { get: vi.fn().mockResolvedValue({ data: { updated_at: '2026-10-09T11:00:00Z', state: 'open', merged: false } }) } } });
        // Review still open: it owns the PR.
        dbMock.teammateTask.findFirst.mockResolvedValue({ status: 'in_progress', updatedAt: new Date('2026-10-09T10:40:00Z') });
        await teammateHeartbeatTick('mate', now);
        // Review finished after the reviewer's PR comment.
        dbMock.teammateTask.findFirst.mockResolvedValue({ status: 'done', updatedAt: new Date('2026-10-09T11:00:05Z') });
        await teammateHeartbeatTick('mate', now);
        expect(wake).not.toHaveBeenCalled();
        // A later PR change (owner comment or merge) still wakes the task.
        dbMock.teammateTask.findFirst.mockResolvedValue({ status: 'done', updatedAt: new Date('2026-10-09T10:50:00Z') });
        await teammateHeartbeatTick('mate', now);
        expect(wake).toHaveBeenCalledTimes(1);
    });
});

describe('dreaming tick', () => {
    it('requires local hour, an activity run, and a 20-hour gap', async () => {
        dbMock.teammateRun.findFirst.mockImplementation(async ({ where }: any) => where.threadId ? null : { id: 'activity' });
        await teammateDreamingTick('mate', now);
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'dreaming', event: expect.objectContaining({ data: { since: now.getTime() - 24 * 60 * 60_000 } }) }));
        enqueue.mockClear();
        dbMock.teammate.findUnique.mockResolvedValue({ ...profile, dreamingHour: 13 });
        await teammateDreamingTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
        dbMock.teammate.findUnique.mockResolvedValue({ ...profile });
        dbMock.teammateRun.findFirst.mockResolvedValue({ queuedAt: new Date(now.getTime() - 60_000) });
        await teammateDreamingTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('skips without activity while manual dreaming still queues', async () => {
        await teammateDreamingTick('mate', now);
        expect(enqueue).not.toHaveBeenCalled();
        await teammateManualScheduledRun('account', 'mate', 'dreaming', now);
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'dreaming', event: expect.objectContaining({ data: { manual: true, since: now.getTime() - 24 * 60 * 60_000 } }) }));
    });
});

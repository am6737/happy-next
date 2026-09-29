import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    session: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
    },
    machine: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('@/storage/db', () => ({ db }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/monitoring/metrics2', () => ({
    sessionCacheCounter: { inc: vi.fn() },
    databaseUpdatesSkippedCounter: { inc: vi.fn() },
}));

describe('activityCache session-end race', () => {
    let activityCache: typeof import('./sessionCache').activityCache;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        db.session.findUnique.mockReset().mockResolvedValue({ id: 's1', lastActiveAt: new Date(0) });
        db.session.updateMany.mockReset().mockResolvedValue({ count: 1 });
        ({ activityCache } = await import('./sessionCache'));
    });

    afterEach(() => {
        activityCache.shutdown();
        vi.useRealTimers();
    });

    it('drops a queued heartbeat when the session ends before the batch flush', async () => {
        await activityCache.isSessionValid('s1', 'u1');
        expect(activityCache.queueSessionUpdate('s1', 100_000)).toBe(true);

        activityCache.markSessionEnded('s1', 100_500);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(db.session.updateMany).not.toHaveBeenCalled();
    });

    it('treats heartbeats at or before session-end as stale, later ones as a resume', async () => {
        activityCache.markSessionEnded('s1', 100_500);

        expect(activityCache.isHeartbeatAfterEnd('s1', 100_000)).toBe(false);
        expect(activityCache.isHeartbeatAfterEnd('s1', 100_500)).toBe(false);
        expect(activityCache.isHeartbeatAfterEnd('s1', 101_000)).toBe(true);
        expect(activityCache.isHeartbeatAfterEnd('other', 0)).toBe(true);
    });

    it('flushes the first heartbeat after a resume even within the update threshold', async () => {
        await activityCache.isSessionValid('s1', 'u1');
        activityCache.queueSessionUpdate('s1', 100_000);
        await vi.advanceTimersByTimeAsync(5_000);
        db.session.updateMany.mockClear();

        activityCache.markSessionEnded('s1', 100_500);
        expect(activityCache.queueSessionUpdate('s1', 105_000)).toBe(true);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(db.session.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', lastActiveAt: { lt: new Date(105_000) } },
            data: { lastActiveAt: new Date(105_000), active: true },
        });
    });
});

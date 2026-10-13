import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeammateSession } from '@prisma/client';

const { executeRaw } = vi.hoisted(() => ({ executeRaw: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: { $executeRaw: executeRaw } }));

import { teammateRunUsageAdd } from './teammateRunUsageAdd';

const now = new Date('2026-10-13T12:00:00Z');
const session = { sessionId: 'session', teammateId: 'mate', threadId: 'thread', role: 'controller' } as TeammateSession;

beforeEach(() => vi.clearAllMocks());

describe('run usage attribution', () => {
    it('updates one eligible run with controller deltas in one atomic statement', async () => {
        await teammateRunUsageAdd(session, { input: 2, cache_read: 3, cache_creation: 4, output: 5, reasoning: 7 }, { total: 0.25 }, now);
        expect(executeRaw).toHaveBeenCalledTimes(1);
        const [strings, ...values] = executeRaw.mock.calls[0];
        const sql = strings.join('?');
        expect(sql).toContain('UPDATE "TeammateRun" AS run');
        expect(sql).toContain('COALESCE(run."inputTokens", 0)');
        expect(sql).toContain("candidate.status IN ('running', 'dispatching')");
        expect(sql).toContain('ORDER BY CASE WHEN candidate.status IN');
        expect(sql).toContain('LIMIT 1');
        expect(values).toEqual([2, 3, 4, 12, 0.25, 'thread', 'mate', new Date(now.getTime() - 120_000), now]);
    });

    it('limits late attribution to runs finished within 120 seconds', async () => {
        await teammateRunUsageAdd(session, {}, { total: 0 }, now);
        const [strings, ...values] = executeRaw.mock.calls[0];
        expect(strings.join('?')).toContain('candidate."finishedAt" >= ? AND candidate."finishedAt" <= ?');
        expect(values.slice(-2)).toEqual([new Date('2026-10-13T11:58:00Z'), now]);
    });

    it('ignores worker sessions', async () => {
        await teammateRunUsageAdd({ ...session, role: 'worker' }, {}, {}, now);
        expect(executeRaw).not.toHaveBeenCalled();
    });

    it('leaves no run unchanged when the statement matches zero rows', async () => {
        executeRaw.mockResolvedValueOnce(0);
        await expect(teammateRunUsageAdd(session, {}, { total: 0 }, now)).resolves.toBeUndefined();
        expect(executeRaw).toHaveBeenCalledTimes(1);
    });
});

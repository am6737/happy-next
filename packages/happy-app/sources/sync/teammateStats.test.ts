import { describe, expect, it } from 'vitest';
import type { TeammateRun } from 'happy-wire';
import { computeTeammateStats } from './teammateStats';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function run(overrides: Partial<TeammateRun>): TeammateRun {
    return {
        id: 'r', teammateId: 't', threadId: 'th', threadKind: 'dm', trigger: 'manual', status: 'completed',
        attempt: 1, failureReason: null, sessionId: null, taskId: null, costUsd: 1, tokens: null, queuedAt: NOW - DAY, startedAt: null, finishedAt: null,
        ...overrides,
    };
}

describe('computeTeammateStats', () => {
    it('returns empty stats without runs', () => {
        expect(computeTeammateStats(undefined, 7, NOW)).toEqual({ costUsd: 0, runCount: 0, failedCount: 0, byTrigger: [] });
    });

    it('filters by range and sums cost', () => {
        const stats = computeTeammateStats([run({ costUsd: 2 }), run({ queuedAt: NOW - 10 * DAY, costUsd: 5 })], 7, NOW);
        expect(stats.runCount).toBe(1);
        expect(stats.costUsd).toBe(2);
        expect(computeTeammateStats([run({ costUsd: 2 }), run({ queuedAt: NOW - 10 * DAY, costUsd: 5 })], 30, NOW).costUsd).toBe(7);
    });

    it('counts failed runs only, not cancelled or running ones', () => {
        const stats = computeTeammateStats([run({}), run({ status: 'failed' }), run({ status: 'failed' }), run({ status: 'cancelled' }), run({ status: 'running' })], 7, NOW);
        expect(stats.failedCount).toBe(2);
    });

    it('groups by trigger sorted by count', () => {
        const stats = computeTeammateStats([run({ trigger: 'heartbeat', costUsd: null }), run({ trigger: 'manual' }), run({ trigger: 'manual', costUsd: 2 })], 7, NOW);
        expect(stats.byTrigger).toEqual([{ trigger: 'manual', count: 2, costUsd: 3 }, { trigger: 'heartbeat', count: 1, costUsd: 0 }]);
    });
});

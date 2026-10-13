import type { TeammateRun, TeammateRunTrigger } from 'happy-wire';

export type TeammateStatsRange = 7 | 30 | 90;

export interface TeammateStats {
    costUsd: number;
    runCount: number;
    /** Runs in the range that ended in failure; cancelled runs do not count. */
    failedCount: number;
    byTrigger: { trigger: TeammateRunTrigger; count: number; costUsd: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregates a teammate's runs queued within the last `days` days.
 */
export function computeTeammateStats(runs: TeammateRun[] | undefined, days: TeammateStatsRange, now: number): TeammateStats {
    const since = now - days * DAY_MS;
    const inRange = (runs ?? []).filter(run => run.queuedAt >= since);
    let costUsd = 0;
    let failed = 0;
    const groups = new Map<TeammateRunTrigger, { trigger: TeammateRunTrigger; count: number; costUsd: number }>();
    for (const run of inRange) {
        const cost = run.costUsd ?? 0;
        costUsd += cost;
        if (run.status === 'failed') failed++;
        const group = groups.get(run.trigger) ?? { trigger: run.trigger, count: 0, costUsd: 0 };
        group.count++;
        group.costUsd += cost;
        groups.set(run.trigger, group);
    }
    return {
        costUsd,
        runCount: inRange.length,
        failedCount: failed,
        byTrigger: [...groups.values()].sort((a, b) => b.count - a.count),
    };
}

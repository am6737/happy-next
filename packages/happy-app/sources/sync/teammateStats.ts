import type { TeammateRun, TeammateRunTrigger } from 'happy-wire';

export type TeammateStatsRange = 7 | 30 | 90;

export interface TeammateStats {
    costUsd: number;
    runCount: number;
    /** 0–100, or null while no run has finished in the range. */
    successRate: number | null;
    byTrigger: { trigger: TeammateRunTrigger; count: number; costUsd: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregates a teammate's runs queued within the last `days` days.
 * Success rate only counts finished runs (completed vs failed); cancelled runs are neutral.
 */
export function computeTeammateStats(runs: TeammateRun[] | undefined, days: TeammateStatsRange, now: number): TeammateStats {
    const since = now - days * DAY_MS;
    const inRange = (runs ?? []).filter(run => run.queuedAt >= since);
    let costUsd = 0;
    let completed = 0;
    let failed = 0;
    const groups = new Map<TeammateRunTrigger, { trigger: TeammateRunTrigger; count: number; costUsd: number }>();
    for (const run of inRange) {
        const cost = run.costUsd ?? 0;
        costUsd += cost;
        if (run.status === 'completed') completed++;
        else if (run.status === 'failed') failed++;
        const group = groups.get(run.trigger) ?? { trigger: run.trigger, count: 0, costUsd: 0 };
        group.count++;
        group.costUsd += cost;
        groups.set(run.trigger, group);
    }
    const finished = completed + failed;
    return {
        costUsd,
        runCount: inRange.length,
        successRate: finished ? Math.round(completed / finished * 100) : null,
        byTrigger: [...groups.values()].sort((a, b) => b.count - a.count),
    };
}

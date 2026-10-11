import type { TeammateRun } from 'happy-wire';

const statusOrder: Record<TeammateRun['status'], number> = {
    queued: 0, dispatching: 1, running: 2, completed: 3, failed: 3, cancelled: 3,
};

export function upsertTeammateRun(runs: TeammateRun[] = [], run: TeammateRun): TeammateRun[] {
    const existing = runs.find(item => item.id === run.id);
    // A POST response can arrive after a later socket transition. Retries get new IDs.
    if (existing && statusOrder[existing.status] > statusOrder[run.status]) return runs;
    return [...runs.filter(item => item.id !== run.id), run]
        .sort((a, b) => b.queuedAt - a.queuedAt || a.id.localeCompare(b.id))
        .slice(0, 50);
}

export function mergeTeammateRunSnapshot(current: TeammateRun[] = [], snapshot: TeammateRun[], baseline: TeammateRun[] = []): TeammateRun[] {
    const beforeRequest = new Map(baseline.map(run => [run.id, run]));
    let merged = snapshot;
    // Preserve updates received while the REST snapshot was being fetched.
    for (const run of current) {
        if (beforeRequest.get(run.id) !== run) merged = upsertTeammateRun(merged, run);
    }
    return [...merged].sort((a, b) => b.queuedAt - a.queuedAt || a.id.localeCompare(b.id)).slice(0, 50);
}

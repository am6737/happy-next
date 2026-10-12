import type { TeammateRun, TeammateTask } from 'happy-wire';
import { isTeammateRunCancellable } from './teammateRuns';
import { isVisibleTeammateRun } from './teammateRunVisibility';

export type TeammateTimelineTone = 'success' | 'failure' | 'neutral';

export interface TeammateTimelineItem {
    run: TeammateRun;
    /** The task the run worked on, when it is still in the store. */
    task: TeammateTask | null;
    /** When the run finished (or was queued, if it never recorded an end). */
    at: number;
    durationMs: number | null;
    tone: TeammateTimelineTone;
}

export interface TeammateTimelineDay {
    /** Local midnight of the day, in ms. */
    day: number;
    items: TeammateTimelineItem[];
}

export function startOfLocalDay(time: number): number {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

const toneByStatus: Partial<Record<TeammateRun['status'], TeammateTimelineTone>> = {
    completed: 'success',
    failed: 'failure',
};

/**
 * Finished runs as a profile activity feed, newest first and grouped by local day. Runs still in flight are
 * left out (the profile shows them in the live card), as are completed heartbeats, which are routine noise.
 */
export function buildTeammateTimeline(runs: TeammateRun[] | undefined, tasks: TeammateTask[] | undefined): TeammateTimelineDay[] {
    const taskById = new Map((tasks ?? []).map(task => [task.id, task]));
    const items = (runs ?? [])
        .filter(run => !isTeammateRunCancellable(run) && isVisibleTeammateRun(run))
        .map((run): TeammateTimelineItem => ({
            run,
            task: run.taskId ? taskById.get(run.taskId) ?? null : null,
            at: run.finishedAt ?? run.queuedAt,
            durationMs: run.startedAt !== null && run.finishedAt !== null ? Math.max(0, run.finishedAt - run.startedAt) : null,
            tone: toneByStatus[run.status] ?? 'neutral',
        }))
        .sort((a, b) => b.at - a.at || a.run.id.localeCompare(b.run.id));
    const days: TeammateTimelineDay[] = [];
    for (const item of items) {
        const day = startOfLocalDay(item.at);
        const last = days[days.length - 1];
        if (last?.day === day) last.items.push(item);
        else days.push({ day, items: [item] });
    }
    return days;
}

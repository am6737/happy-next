import type { TeammateTask, TeammateTaskDetail, TeammateRun } from 'happy-wire';
import { upsertTeammateRun, mergeTeammateRunSnapshot } from './teammateRuns';

export interface TeammateTaskState {
    teammateTasks: Record<string, TeammateTask[]>;
    teammateTaskDetails: Record<string, TeammateTaskDetail>;
    teammateTaskResourceIndex: Record<string, string[]>;
}
export const emptyTeammateTaskState: TeammateTaskState = {
    teammateTasks: {}, teammateTaskDetails: {}, teammateTaskResourceIndex: {},
};
const sorted = (tasks: TeammateTask[]) => tasks.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
/** All task representations share the newest version, including late REST responses. */
export function reduceTeammateTask(state: TeammateTaskState, task: TeammateTask): TeammateTaskState {
    const current = state.teammateTasks[task.teammateId] ?? [];
    const previous = current.find(t => t.id === task.id) ?? state.teammateTaskDetails[task.id]?.task;
    if (previous && previous.updatedAt > task.updatedAt) task = previous;
    const teammateTasks = { ...state.teammateTasks, [task.teammateId]: sorted([...current.filter(t => t.id !== task.id), task]) };
    const teammateTaskDetails = { ...state.teammateTaskDetails };
    teammateTaskDetails[task.id] = { ...(teammateTaskDetails[task.id] ?? { sessions: [], runs: [] }), task };
    const teammateTaskResourceIndex = { ...state.teammateTaskResourceIndex };
    if (task.resourceId) {
        const ids = new Set([...(teammateTaskResourceIndex[task.resourceId] ?? []), task.id]);
        const all = Object.values(teammateTasks).flat();
        teammateTaskResourceIndex[task.resourceId] = sorted(all.filter(t => ids.has(t.id))).map(t => t.id);
    }
    return { teammateTasks, teammateTaskDetails, teammateTaskResourceIndex };
}
export function reduceTeammateTaskDetail(state: TeammateTaskState, detail: TeammateTaskDetail, baseline?: TeammateTaskDetail): TeammateTaskState {
    const next = reduceTeammateTask(state, detail.task);
    const current = state.teammateTaskDetails[detail.task.id];
    next.teammateTaskDetails[detail.task.id] = { ...detail,
        task: next.teammateTasks[detail.task.teammateId].find(t => t.id === detail.task.id)!,
        runs: mergeTeammateRunSnapshot(current?.runs, detail.runs, baseline?.runs),
    };
    return next;
}
export function reduceTeammateTaskRun(details: Record<string, TeammateTaskDetail>, run: TeammateRun) {
    if (!run.taskId || !details[run.taskId]) return details;
    return { ...details, [run.taskId]: { ...details[run.taskId], runs: upsertTeammateRun(details[run.taskId].runs, run) } };
}

import type { Teammate, TeammateRun, TeammateTask } from 'happy-wire';

export function getTeammateWorkload(teammate: Teammate, runs: TeammateRun[] = [], tasks: TeammateTask[] = []): 'idle' | 'working' | 'waiting' | 'budgetPaused' | 'paused' {
    if (teammate.status === 'budget_paused') return 'budgetPaused';
    if (teammate.status === 'paused') return 'paused';
    if (tasks.some(task => task.status === 'awaiting_input' || task.status === 'in_review')) return 'waiting';
    if (runs.some(run => run.status === 'dispatching' || run.status === 'running') || tasks.some(task => task.status === 'in_progress')) return 'working';
    return 'idle';
}

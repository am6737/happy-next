import type { OrchestratorExecutionRecord, OrchestratorRunDetail, OrchestratorRunStatus, OrchestratorRunSummary, OrchestratorTaskRecord } from '@/sync/apiOrchestrator';
import { MODEL_MODE_DEFAULT } from 'happy-wire';

function isMarkdownFenceLine(value: string): boolean {
    return /^```(?:[\w-]+)?$/.test(value.trim());
}

export function formatOrchestratorProviderLabel(task: Pick<OrchestratorTaskRecord, 'provider' | 'model'>): string {
    const model = task.model?.trim() || MODEL_MODE_DEFAULT;
    return `${task.provider} · ${model}`;
}

export function resolveOrchestratorAttemptDisplay(task: Pick<OrchestratorTaskRecord, 'retry' | 'executions'>): { current: number; max: number; } {
    const executions = task.executions ?? [];
    const maxAttempt = executions.reduce((value, execution) => Math.max(value, execution.attempt), 0);
    const current = Math.max(executions.length, maxAttempt);
    const max = Math.max(task.retry.maxAttempts, current);
    return { current, max };
}

export function resolveTaskMachineId(task: Pick<OrchestratorTaskRecord, 'executions' | 'status'>): string | null {
    const executions = task.executions ?? [];
    if (executions.length === 0) {
        return null;
    }
    if (task.status === 'running' || task.status === 'dispatching') {
        const active = executions.filter((execution) => execution.status === 'running' || execution.status === 'dispatching');
        if (active.length > 0) {
            return active[active.length - 1].machineId;
        }
    }
    return executions[executions.length - 1].machineId;
}

export function shortenMachineId(machineId: string): string {
    return machineId.length > 8 ? machineId.substring(0, 8) : machineId;
}

export function resolveMachineName(machineId: string, nameMap: ReadonlyMap<string, string>): string {
    const name = nameMap.get(machineId);
    if (name) {
        return `${name} (${shortenMachineId(machineId)})`;
    }
    return shortenMachineId(machineId);
}

export function sanitizeOrchestratorOutputSummary(summary: string | null | undefined): string | null {
    if (!summary) {
        return null;
    }

    const cleaned = summary
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !isMarkdownFenceLine(line));

    if (cleaned.length === 0) {
        return null;
    }

    return cleaned.join(' ').trim();
}

export function resolveOrchestratorExecutionPrompt(
    taskPrompt: string | null | undefined,
    execution: Pick<OrchestratorExecutionRecord, 'resumeMessage'>,
): string | null {
    return execution.resumeMessage?.trim() || taskPrompt?.trim() || null;
}

export function resolveOrchestratorSummaryLineData(summary: OrchestratorRunSummary): Pick<OrchestratorRunSummary, 'total' | 'running' | 'completed' | 'failed' | 'cancelled'> {
    const running = summary.running + summary.queued;
    return {
        total: summary.total,
        running,
        completed: summary.completed,
        failed: summary.failed,
        cancelled: summary.cancelled,
    };
}

export function resolveOrchestratorSummaryLineDataFromTasks(
    summary: OrchestratorRunSummary,
    tasks: Array<Pick<OrchestratorTaskRecord, 'status'>> | undefined,
): Pick<OrchestratorRunSummary, 'total' | 'running' | 'completed' | 'failed' | 'cancelled'> {
    if (!tasks || tasks.length === 0) {
        return resolveOrchestratorSummaryLineData(summary);
    }

    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const task of tasks) {
        if (task.status === 'queued' || task.status === 'dispatching' || task.status === 'running') {
            running += 1;
            continue;
        }
        if (task.status === 'completed') {
            completed += 1;
            continue;
        }
        if (task.status === 'failed' || task.status === 'dependency_failed') {
            failed += 1;
            continue;
        }
        if (task.status === 'cancelled') {
            cancelled += 1;
        }
    }

    return {
        total: tasks.length,
        running,
        completed,
        failed,
        cancelled,
    };
}

export function sortOrchestratorExecutionsByAttemptDesc(executions: OrchestratorExecutionRecord[]): OrchestratorExecutionRecord[] {
    return [...executions].sort((a, b) => b.attempt - a.attempt);
}

/** The text of the most recent assistant message, which is what a running task is currently saying. */
export function pickLatestAssistantMessage(messages: ReadonlyArray<{ role: string; content: string }>): string | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === 'assistant' && message.content.trim()) {
            return message.content.trim();
        }
    }
    return null;
}

// Lives here rather than in status.ts, which pulls in UI modules these pure helpers must not need
export function isRunActive(status: OrchestratorRunStatus): boolean {
    return status === 'queued' || status === 'running' || status === 'canceling';
}

function elapsedMs(startIso: string, endMs: number): number | null {
    const start = Date.parse(startIso);
    return Number.isNaN(start) || Number.isNaN(endMs) ? null : Math.max(0, endMs - start);
}

/**
 * How long one execution has been running, or ran. Not started yet: null. A running one is
 * measured up to `now`; a finished one up to the time the daemon reported (both come from the
 * machine's clock), falling back to the last update when that is missing.
 */
export function resolveExecutionDurationMs(
    execution: Pick<OrchestratorExecutionRecord, 'status' | 'startedAt' | 'finishedAt' | 'updatedAt'>,
    now: number,
): number | null {
    if (!execution.startedAt) {
        return null;
    }
    const end = execution.status === 'running' ? now : Date.parse(execution.finishedAt ?? execution.updatedAt);
    return elapsedMs(execution.startedAt, end);
}

/** A task's time spent running: its attempts added up, so waiting between retries is not counted. */
export function resolveTaskDurationMs(task: Pick<OrchestratorTaskRecord, 'executions'>, now: number): number | null {
    const durations = (task.executions ?? [])
        .map((execution) => resolveExecutionDurationMs(execution, now))
        .filter((duration): duration is number => duration !== null);
    return durations.length > 0 ? durations.reduce((sum, duration) => sum + duration, 0) : null;
}

/** A run's total time from creation, which includes queueing, up to now or to when it ended. */
export function resolveRunDurationMs(
    run: Pick<OrchestratorRunDetail, 'status' | 'createdAt' | 'updatedAt' | 'completedAt'>,
    now: number,
): number | null {
    const end = isRunActive(run.status) ? now : Date.parse(run.completedAt ?? run.updatedAt);
    return elapsedMs(run.createdAt, end);
}

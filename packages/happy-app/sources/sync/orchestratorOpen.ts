import { t } from '@/text';
import type { Encryption } from './encryption/encryption';
import type { OrchestratorExecutionRecord, OrchestratorTaskRecord } from './apiOrchestrator';

/**
 * Orchestrator tasks are sealed end to end with the account's orchestrator key (see
 * happy-cli/src/orchestrator/seal.ts): run and task titles, what a task does, its follow-ups and
 * its results reach the app sealed, and are opened here into the fields the views show. What the
 * key does not open (sealed with another key, or altered) shows as undecryptable.
 */

type SealedFields = { sealedResult?: string | null };
export type SealedTaskRecord = Omit<OrchestratorTaskRecord, 'executions'> & SealedFields & {
    executions?: Array<OrchestratorExecutionRecord & SealedFields>;
};

type OpenedResult = {
    kind?: string;
    taskId?: string;
    executionId?: string;
    outputSummary?: string | null;
    outputText?: string | null;
    stderrText?: string | null;
    errorMessage?: string | null;
};

function isSealed(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('e2e1:');
}

export async function openOrchestratorTitle<T extends string | null>(title: T, encryption: Encryption): Promise<T | string> {
    if (!isSealed(title)) {
        return title;
    }
    const [opened] = await encryption.openOrchestrator([title]);
    return typeof opened?.title === 'string' ? opened.title : t('settings.orchestratorUndecryptable');
}

// A result opens into the record only when sealed for it: one the server moved over from another
// task or execution does not
function applyResult<R extends { outputSummary: string | null; outputText: string | null; stderrText?: string | null; errorMessage: string | null }>(
    record: R & SealedFields,
    opened: OpenedResult | null,
    taskId: string,
    executionId?: string,
): R {
    const { sealedResult, ...rest } = record;
    if (!sealedResult) {
        return rest as R;
    }
    const valid = opened?.kind === 'result' && opened.taskId === taskId && (executionId === undefined || opened.executionId === executionId);
    if (!valid) {
        return { ...rest, errorMessage: t('settings.orchestratorUndecryptable') } as R;
    }
    return {
        ...rest,
        outputSummary: opened.outputSummary ?? null,
        outputText: opened.outputText ?? null,
        stderrText: opened.stderrText ?? null,
        errorMessage: opened.errorMessage ?? rest.errorMessage,
    } as R;
}

// What the task's envelope says, in the fields the views read: a transfer's prompt is its spec
// as JSON (see parseOrchestratorTransferSpec). Runs list tasks without their prompts, so the
// working directory, sealed on its own too, is opened from there.
function applyEnvelope(task: OrchestratorTaskRecord, envelope: any, workingDirectory: any): Pick<OrchestratorTaskRecord, 'prompt' | 'workingDirectory'> {
    switch (envelope?.kind) {
        case 'task':
            return { prompt: envelope.prompt, workingDirectory: envelope.workingDirectory ?? null };
        case 'shell':
            return { prompt: envelope.command, workingDirectory: envelope.workingDirectory ?? null };
        case 'transfer':
            return {
                prompt: JSON.stringify({
                    sourceMachineId: envelope.sourceMachineId,
                    sourcePath: envelope.sourcePath,
                    targetPath: envelope.targetPath,
                    overwrite: envelope.overwrite,
                }),
                workingDirectory: null,
            };
        default: {
            const openedWorkingDirectory = isSealed(task.workingDirectory)
                ? (typeof workingDirectory === 'string' ? workingDirectory : t('settings.orchestratorUndecryptable'))
                : task.workingDirectory;
            return isSealed(task.prompt)
                ? { prompt: t('settings.orchestratorUndecryptable'), workingDirectory: openedWorkingDirectory }
                : { prompt: task.prompt, workingDirectory: openedWorkingDirectory };
        }
    }
}

export async function openOrchestratorTask(task: SealedTaskRecord, encryption: Encryption): Promise<OrchestratorTaskRecord> {
    const executions = task.executions ?? [];
    const [title, envelope, workingDirectory, result, ...opened] = await encryption.openOrchestrator([
        task.title,
        task.prompt,
        task.workingDirectory,
        task.sealedResult,
        ...executions.flatMap((execution) => [execution.sealedResult, execution.resumeMessage]),
    ]);
    const openedTask: OrchestratorTaskRecord = {
        ...applyResult(task, result, task.taskId),
        ...applyEnvelope(task, envelope, workingDirectory),
        title: isSealed(task.title)
            ? (typeof title?.title === 'string' ? title.title : t('settings.orchestratorUndecryptable'))
            : task.title,
    };
    if (!task.executions) {
        return openedTask;
    }
    return {
        ...openedTask,
        executions: executions.map((execution, index) => {
            const resume = opened[index * 2 + 1];
            const resumeValid = resume?.kind === 'resume' && resume.taskId === task.taskId && typeof resume.message === 'string';
            return {
                ...applyResult(execution, opened[index * 2], task.taskId, execution.executionId),
                resumeMessage: isSealed(execution.resumeMessage)
                    ? (resumeValid ? resume.message : t('settings.orchestratorUndecryptable'))
                    : execution.resumeMessage,
            };
        }),
    };
}

export async function openOrchestratorTasks(tasks: SealedTaskRecord[] | undefined, encryption: Encryption): Promise<OrchestratorTaskRecord[] | undefined> {
    return tasks && Promise.all(tasks.map((task) => openOrchestratorTask(task, encryption)));
}

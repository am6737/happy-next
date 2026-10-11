import type { OrchestratorTaskStatus } from '@/sync/apiOrchestrator';
import { parseMcpResult } from './parseMcpResult';

/** One machine's part of a `machine_exec` result. */
export type MachineExecTaskResult = {
    taskId: string;
    machineId: string;
    status: OrchestratorTaskStatus;
    stdout: string | null;
    stderr: string | null;
    errorMessage: string | null;
};

export type MachineExecResult = {
    runId: string;
    /** Whether every machine had finished when the call returned; the run goes on otherwise. */
    terminal: boolean;
    tasks: MachineExecTaskResult[];
};

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function isMachineExecToolName(toolName: string): boolean {
    return /(^|__)machine_exec$/.test(toolName.replace(/:/g, '__'));
}

/**
 * How far the command a `machine_exec` call ran had got on each machine when the call returned;
 * null for a result of another shape, such as an error.
 */
export function parseMachineExecResult(result: unknown): MachineExecResult | null {
    const parsed = parseMcpResult(result);
    const data = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>).data : null;
    const runId = asString(data?.runId);
    if (!runId || !Array.isArray(data.tasks)) {
        return null;
    }
    return {
        runId,
        terminal: data.terminal === true,
        tasks: data.tasks.flatMap((task: unknown) => {
            const record = task && typeof task === 'object' ? task as Record<string, unknown> : null;
            const taskId = asString(record?.taskId);
            const machineId = asString(record?.machineId);
            const status = asString(record?.status);
            if (!record || !taskId || !machineId || !status) {
                return [];
            }
            return [{
                taskId,
                machineId,
                status: status as OrchestratorTaskStatus,
                stdout: asString(record.stdout),
                stderr: asString(record.stderr),
                errorMessage: asString(record.errorMessage),
            }];
        }),
    };
}

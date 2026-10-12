import { describe, expect, it } from 'vitest';
import { isOrchestratorExecToolName, parseOrchestratorExecResult } from './orchestratorExecResult';

describe('isOrchestratorExecToolName', () => {
    it('matches orchestrator_exec under any MCP prefix', () => {
        expect(isOrchestratorExecToolName('mcp__happy__orchestrator_exec')).toBe(true);
        expect(isOrchestratorExecToolName('happy:orchestrator_exec')).toBe(true);
        expect(isOrchestratorExecToolName('orchestrator_exec')).toBe(true);
        expect(isOrchestratorExecToolName('mcp__happy__orchestrator_submit')).toBe(false);
        expect(isOrchestratorExecToolName('mcp__other__my_orchestrator_exec_tool')).toBe(false);
    });
});

describe('parseOrchestratorExecResult', () => {
    it('reads each machine of a result in MCP text content', () => {
        const result = [{
            type: 'text',
            text: JSON.stringify({
                ok: true,
                data: {
                    runId: 'run-1',
                    terminal: false,
                    tasks: [
                        { taskId: 't1', machineId: 'm1', status: 'failed', exitCode: 2, stdout: '', stderr: 'boom\n', errorMessage: 'Command exited with code 2' },
                        { taskId: 't2', machineId: 'm2', status: 'running', exitCode: null, stdout: null, stderr: null, errorMessage: null },
                        { machineId: 'm3', status: 'running' },
                    ],
                },
            }),
        }];
        expect(parseOrchestratorExecResult(result)).toEqual({
            runId: 'run-1',
            terminal: false,
            tasks: [
                { taskId: 't1', machineId: 'm1', status: 'failed', stdout: null, stderr: 'boom\n', errorMessage: 'Command exited with code 2' },
                { taskId: 't2', machineId: 'm2', status: 'running', stdout: null, stderr: null, errorMessage: null },
            ],
        });
    });

    it('returns null for an error result', () => {
        expect(parseOrchestratorExecResult([{ type: 'text', text: 'Error: Failed to run the command' }])).toBeNull();
        expect(parseOrchestratorExecResult({ ok: false, error: 'nope' })).toBeNull();
    });
});

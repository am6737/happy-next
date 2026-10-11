import { describe, expect, it } from 'vitest';
import { isMachineExecToolName, parseMachineExecResult } from './machineExecResult';

describe('isMachineExecToolName', () => {
    it('matches machine_exec under any MCP prefix', () => {
        expect(isMachineExecToolName('mcp__happy__machine_exec')).toBe(true);
        expect(isMachineExecToolName('happy:machine_exec')).toBe(true);
        expect(isMachineExecToolName('machine_exec')).toBe(true);
        expect(isMachineExecToolName('mcp__happy__orchestrator_submit')).toBe(false);
        expect(isMachineExecToolName('mcp__other__my_machine_exec_tool')).toBe(false);
    });
});

describe('parseMachineExecResult', () => {
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
        expect(parseMachineExecResult(result)).toEqual({
            runId: 'run-1',
            terminal: false,
            tasks: [
                { taskId: 't1', machineId: 'm1', status: 'failed', stdout: null, stderr: 'boom\n', errorMessage: 'Command exited with code 2' },
                { taskId: 't2', machineId: 'm2', status: 'running', stdout: null, stderr: null, errorMessage: null },
            ],
        });
    });

    it('returns null for an error result', () => {
        expect(parseMachineExecResult([{ type: 'text', text: 'Error: Failed to run the command' }])).toBeNull();
        expect(parseMachineExecResult({ ok: false, error: 'nope' })).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import {
  applyDefaultWorkingDirectory,
  appendOutputChunk,
  buildExecutionOutputText,
  buildOrchestratorEnv,
  buildOutputSummary,
  compactShellTasks,
  decodePromptFromBase64,
  mapFinishStatus,
  SHELL_OUTPUT_BUDGET_CHARS,
  type OrchestratorDispatchPayload,
} from './common';

describe('orchestrator common helpers', () => {
  it('maps finish status by watchdog/cancel/exitCode priority', () => {
    expect(mapFinishStatus({ watchdogTriggered: true, cancelRequested: false, exitCode: 0 })).toBe('timeout');
    expect(mapFinishStatus({ watchdogTriggered: false, cancelRequested: true, exitCode: 0 })).toBe('cancelled');
    expect(mapFinishStatus({ watchdogTriggered: false, cancelRequested: false, exitCode: 0 })).toBe('completed');
    expect(mapFinishStatus({ watchdogTriggered: false, cancelRequested: false, exitCode: 1 })).toBe('failed');
  });

  it('builds env payload with base64 prompt', () => {
    const payload: OrchestratorDispatchPayload = {
      executionId: 'exec_1',
      runId: 'run_1',
      taskId: 'task_1',
      dispatchToken: 'token_1',
      provider: 'codex',
      executionType: 'initial',
      model: 'gpt-5.3-codex-high',
      prompt: '请总结这个目录',
      timeoutMs: 60_000,
      workingDirectory: '/tmp/project',
    };

    const env = buildOrchestratorEnv(payload);
    expect(env.HAPPY_ORCH_ONESHOT).toBe('1');
    expect(env.HAPPY_ORCH_EXECUTION_ID).toBe('exec_1');
    expect(env.HAPPY_ORCH_EXECUTION_TYPE).toBe('initial');
    expect(env.HAPPY_ORCH_MODEL_MODE).toBe('gpt-5.3-codex-high');
    expect(env.HAPPY_ORCH_TIMEOUT_MS).toBe('60000');
    expect(env.HAPPY_ORCH_WORKING_DIRECTORY).toBe('/tmp/project');
    expect(decodePromptFromBase64(env.HAPPY_ORCH_PROMPT_B64)).toBe(payload.prompt);
  });

  it('keeps output buffer tail when exceeding capture limit', () => {
    const first = appendOutputChunk('', 'abc', 5);
    const second = appendOutputChunk(first, 'def', 5);
    expect(second).toBe('bcdef');
  });

  it('builds summary from the beginning of stdout, falling back to the last stderr line', () => {
    expect(buildOutputSummary('line1\nline2\n', 'noise')).toBe('line1\nline2');
    expect(buildOutputSummary('x'.repeat(300), '')).toBe(`${'x'.repeat(197)}...`);
    expect(buildOutputSummary('', 'first\n err line \n')).toBe('err line');
    expect(buildOutputSummary('   ', '   ')).toBeNull();
  });

  it('uses only stdout as the result of a completed execution', () => {
    expect(buildExecutionOutputText({ status: 'completed', stdout: ' final answer \n', stderr: 'progress log\nmore log' })).toBe('final answer');
  });

  it('attaches the stderr tail when the execution did not complete or printed nothing', () => {
    const stderr = Array.from({ length: 100 }, (_, index) => `log ${index}`).join('\n');
    const failed = buildExecutionOutputText({ status: 'failed', stdout: 'partial', stderr });
    expect(failed.startsWith('partial\nlog 60\n')).toBe(true);
    expect(failed.endsWith('log 99')).toBe(true);
    expect(failed).not.toContain('log 59\n');
    expect(buildExecutionOutputText({ status: 'completed', stdout: '  ', stderr: 'boom' })).toBe('boom');
    expect(buildExecutionOutputText({ status: 'timeout', stdout: '', stderr: '' })).toBe('');
  });

  it('applies default workingDirectory to tasks that do not provide one', () => {
    const tasks = [
      { prompt: 'task-a' },
      { prompt: 'task-b', workingDirectory: '/tmp/custom' },
      { prompt: 'task-c', workingDirectory: '   ' },
    ];

    const result = applyDefaultWorkingDirectory(tasks, '/tmp/default-project');

    expect(result).toEqual([
      { prompt: 'task-a', workingDirectory: '/tmp/default-project' },
      { prompt: 'task-b', workingDirectory: '/tmp/custom' },
      { prompt: 'task-c', workingDirectory: '/tmp/default-project' },
    ]);
    expect(tasks).toEqual([
      { prompt: 'task-a' },
      { prompt: 'task-b', workingDirectory: '/tmp/custom' },
      { prompt: 'task-c', workingDirectory: '   ' },
    ]);
  });

  it('skips default workingDirectory for tasks targeting a different machine', () => {
    const tasks = [
      { prompt: 'local-task' },
      { prompt: 'local-explicit', target: { type: 'current_machine' } },
      { prompt: 'same-machine', target: { type: 'machine_id', machineId: 'machine-A' } },
      { prompt: 'remote-task', target: { type: 'machine_id', machineId: 'machine-B' } },
      { prompt: 'remote-with-dir', target: { type: 'machine_id', machineId: 'machine-B' }, workingDirectory: '/remote/path' },
    ];

    const result = applyDefaultWorkingDirectory(tasks, '/tmp/default-project', 'machine-A');

    expect(result).toEqual([
      { prompt: 'local-task', workingDirectory: '/tmp/default-project' },
      { prompt: 'local-explicit', target: { type: 'current_machine' }, workingDirectory: '/tmp/default-project' },
      { prompt: 'same-machine', target: { type: 'machine_id', machineId: 'machine-A' }, workingDirectory: '/tmp/default-project' },
      { prompt: 'remote-task', target: { type: 'machine_id', machineId: 'machine-B' } },
      { prompt: 'remote-with-dir', target: { type: 'machine_id', machineId: 'machine-B' }, workingDirectory: '/remote/path' },
    ]);
  });

  it('shows a shell task\'s output in full when it fits, without the output files', () => {
    const tasks = [{ taskId: 't1', machineId: 'm1', exitCode: 0, stdout: 'x'.repeat(14_000), stderr: 'warn', stdoutFile: null, stderrFile: null }];
    expect(compactShellTasks(tasks)).toEqual([{ taskId: 't1', machineId: 'm1', exitCode: 0, stdout: 'x'.repeat(14_000), stderr: 'warn' }]);
  });

  it('shows the end of an output saved to a file, and where the file is', () => {
    const stdout = `start${'x'.repeat(20_000)}end`;
    const [task] = compactShellTasks([{
      taskId: 't1',
      machineId: 'm1',
      stdout,
      stderr: '',
      stdoutFile: { path: '/home/u/.happy-next/exec-output/r1/t1.stdout.log', chars: 500_000, lines: 9_000, complete: true },
      stderrFile: null,
    }]);

    const [marker, shown] = task.stdout.split('\n');
    expect(marker).toBe('[Output too long: 500000 characters in 9000 lines, showing the last 4000. The full output is saved on machine m1 at /home/u/.happy-next/exec-output/r1/t1.stdout.log; read parts of it with orchestrator_exec on that machine (grep -n, tail -n, sed -n).]');
    expect(shown).toBe(stdout.slice(-4_000));
    expect(task).not.toHaveProperty('stdoutFile');
    expect(task.stderr).toBe('');

    const [capped] = compactShellTasks([{ machineId: 'm1', stdout, stdoutFile: { path: '/p', chars: 2e8, lines: 1, complete: false } }]);
    expect(capped.stdout).toContain('Its first 100 MB are saved on machine m1 at /p;');
  });

  it('shares the budget among several tasks, a short output leaving its rest to the long ones', () => {
    const long = (label: string) => `${label}-start${'x'.repeat(40_000)}${label}-end`;
    const tasks = compactShellTasks([
      { taskId: 't1', machineId: 'm1', stdout: long('a'), stderr: 'oops' },
      { taskId: 't2', machineId: 'm2', stdout: long('b'), stderr: '' },
      { taskId: 'ai', outputText: 'an AI task passes through' },
    ]);

    expect(tasks[0].stderr).toBe('oops');
    expect(tasks[2]).toEqual({ taskId: 'ai', outputText: 'an AI task passes through' });
    for (const [task, label] of [[tasks[0], 'a'], [tasks[1], 'b']] as const) {
      expect(task.stdout.startsWith(`${label}-start`)).toBe(true);
      expect(task.stdout.endsWith(`${label}-end`)).toBe(true);
      expect(task.stdout).toMatch(/\n\[\.\.\. \d+ characters omitted; orchestrator_pend with taskId shows more \.\.\.\]\n/);
    }
    const shown = (text: string) => text.replace(/\n\[\.\.\. .* \.\.\.\]\n/, '').length;
    expect(shown(tasks[0].stdout) + shown(tasks[1].stdout) + 'oops'.length).toBe(SHELL_OUTPUT_BUDGET_CHARS);
    expect(shown(tasks[0].stdout)).toBe(shown(tasks[1].stdout));
  });
});

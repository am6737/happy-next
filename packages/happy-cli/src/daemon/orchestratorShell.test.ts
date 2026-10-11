import { describe, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';

import type { ApiClient } from '@/api/api';
import type { OrchestratorShellDispatchPayload } from '@/orchestrator/common';
import { createOrchestratorShellExecutor } from './orchestratorShell';

type FinishReport = Parameters<ApiClient['reportOrchestratorExecutionFinish']>[0];

function setup() {
  const finished = new Map<string, (report: FinishReport) => void>();
  const reports = new Map<string, Promise<FinishReport>>();
  const api = {
    reportOrchestratorExecutionStart: vi.fn(async () => {}),
    reportOrchestratorExecutionFinish: vi.fn(async (report: FinishReport) => {
      finished.get(report.executionId)?.(report);
    }),
  } as unknown as ApiClient;
  const executor = createOrchestratorShellExecutor(api);
  let next = 0;
  const run = async (command: string, options: Partial<OrchestratorShellDispatchPayload> = {}) => {
    const executionId = `exec-${next++}`;
    reports.set(executionId, new Promise((resolve) => finished.set(executionId, resolve)));
    const payload: OrchestratorShellDispatchPayload = {
      executionId,
      runId: 'run-1',
      taskId: `task-${executionId}`,
      dispatchToken: `token-${executionId}`,
      provider: 'shell',
      prompt: command,
      timeoutMs: null,
      ...options,
    };
    await executor.dispatch(payload);
    return { payload, report: reports.get(executionId)! };
  };
  return { api, executor, run };
}

describe.skipIf(process.platform === 'win32')('orchestrator shell executor', () => {
  it('reports exit code, stdout and stderr separately', async () => {
    const { executor, run } = setup();
    const { report } = await run('echo out; echo err >&2; exit 3');
    expect(executor.liveExecutionIds()).toHaveLength(1);

    const result = await report;
    expect(result).toMatchObject({
      status: 'failed',
      exitCode: 3,
      outputText: 'out\n',
      stderrText: 'err\n',
      errorCode: 'PROCESS_EXIT_NON_ZERO',
    });
    await vi.waitFor(() => expect(executor.liveExecutionIds()).toHaveLength(0));
  });

  it('completes on exit code 0, in the given working directory', async () => {
    const { run } = setup();
    const { report } = await run('pwd', { workingDirectory: '/tmp' });
    expect(await report).toMatchObject({ status: 'completed', exitCode: 0, errorCode: undefined });
    expect((await report).outputText?.trim()).toMatch(/\/tmp$/);
  });

  it('fails with a clear error when the working directory is missing', async () => {
    const { run } = setup();
    const { report } = await run('true', { workingDirectory: '/nonexistent/happy-shell-test' });
    expect(await report).toMatchObject({
      status: 'failed',
      errorCode: 'SPAWN_ERROR',
      errorMessage: 'Working directory not found: /nonexistent/happy-shell-test',
    });
  });

  it('times out and kills everything the command started', async () => {
    const { run } = setup();
    const marker = `happy-shell-timeout-${process.pid}-${Date.now()}`;
    const { report } = await run(`sleep 30 & sleep 31; echo ${marker}`, { timeoutMs: 300 });
    expect(await report).toMatchObject({ status: 'timeout', errorCode: 'WATCHDOG_TIMEOUT' });
    await vi.waitFor(() => {
      // `[h]` keeps pgrep from matching the shell running it, whose command line holds the pattern
      expect(execSync(`pgrep -f "[h]${marker.slice(1)}" || true`).toString().trim()).toBe('');
    });
  }, 15_000);

  it('cancels a running command', async () => {
    const { executor, run } = setup();
    const { payload, report } = await run('sleep 30');
    expect(executor.cancel({ ...payload })).toEqual({ accepted: true });
    expect(await report).toMatchObject({ status: 'cancelled' });
    expect(executor.cancel({ ...payload, executionId: 'unknown' })).toBeNull();
  }, 15_000);

  it('finishes when the shell exits, though a background process keeps its output open', async () => {
    const { run } = setup();
    const startedAt = Date.now();
    const { report } = await run('echo started; sleep 5 & exit 0');
    expect(await report).toMatchObject({ status: 'completed', outputText: 'started\n' });
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  }, 15_000);

  it('keeps the head and tail of a long output', async () => {
    const { run } = setup();
    const { report } = await run(`echo first; head -c 200000 /dev/zero | tr '\\0' x; echo; echo last`);
    const { outputText } = await report;
    expect(outputText?.startsWith('first\n')).toBe(true);
    expect(outputText?.endsWith('last\n')).toBe(true);
    expect(outputText).toMatch(/\[\.\.\. \d+ characters omitted \.\.\.\]/);
    expect(outputText!.length).toBeLessThan(70_000);
  });

  it('accepts a repeated dispatch once and rejects a conflicting one', async () => {
    const { executor, run } = setup();
    const { payload, report } = await run('sleep 1');
    expect(await executor.dispatch(payload)).toEqual({ accepted: true, duplicate: true });
    await expect(executor.dispatch({ ...payload, dispatchToken: 'other' })).rejects.toThrow('different dispatchToken');
    await report;
  });
});

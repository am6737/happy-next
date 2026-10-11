import os from 'os';
import { existsSync } from 'fs';
import { basename } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import axios from 'axios';

import type { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { delay } from '@/utils/time';
import {
  buildOutputSummary,
  mapFinishStatus,
  type OrchestratorCancelPayload,
  type OrchestratorShellDispatchPayload,
} from '@/orchestrator/common';

const SHELL_KILL_GRACE_MS = 5_000;
// After the shell exits, how long its output may keep arriving. A command that left a background
// process holding the shell's stdout open (`server &`) would otherwise never finish.
const SHELL_OUTPUT_DRAIN_MS = 1_000;
// Per stream: the first and the last half of this are kept, so both how a command started and
// how it ended survive a long output
const SHELL_OUTPUT_CAPTURE_LIMIT = 64_000;
const SHELL_SHUTDOWN_WAIT_MS = 8_000;
const REPORT_RETRY_MIN_DELAY_MS = 1_000;
const REPORT_RETRY_MAX_DELAY_MS = 30_000;
// The server fails an execution whose start it has not heard of within a minute
const START_REPORT_DEADLINE_MS = 45_000;

/**
 * The shell that runs remote commands: the user's login shell, so a command sees the PATH and
 * environment the user has in a terminal; PowerShell on Windows.
 */
export const remoteShell = process.platform === 'win32'
  ? { name: 'powershell', file: 'powershell.exe', args: (command: string) => ['-NoProfile', '-NonInteractive', '-Command', command] }
  : (() => {
    const file = process.env.SHELL || '/bin/sh';
    return { name: basename(file), file, args: (command: string) => ['-lc', command] };
  })();

type CapturedOutput = {
  head: string;
  tail: string;
  omitted: number;
};

type ShellExecution = {
  payload: OrchestratorShellDispatchPayload;
  child: ChildProcess;
  cwd: string;
  cancelRequested: boolean;
  watchdogTriggered: boolean;
  finished: boolean;
  stdout: CapturedOutput;
  stderr: CapturedOutput;
  startReport: Promise<void>;
  watchdogTimer: NodeJS.Timeout | null;
};

function captureChunk(output: CapturedOutput, chunk: string) {
  const half = SHELL_OUTPUT_CAPTURE_LIMIT / 2;
  const toHead = chunk.slice(0, Math.max(0, half - output.head.length));
  output.head += toHead;
  const tail = output.tail + chunk.slice(toHead.length);
  output.omitted += Math.max(0, tail.length - half);
  output.tail = tail.slice(-half);
}

function renderCapturedOutput(output: CapturedOutput): string {
  return output.omitted > 0
    ? `${output.head}\n[... ${output.omitted} characters omitted ...]\n${output.tail}`
    : output.head + output.tail;
}

/**
 * Report to the server until it records the report, retrying with backoff across network
 * failures and server restarts until `deadline`. A 4xx answer is final: the server will not take
 * this report however often it is sent (or, for a server from before the report, cannot).
 */
export async function reportWithRetry(label: string, send: () => Promise<void>, deadline: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      await send();
      return;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const rejected = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
      const wait = Math.min(REPORT_RETRY_MAX_DELAY_MS, REPORT_RETRY_MIN_DELAY_MS * 2 ** attempt);
      if (rejected || Date.now() + wait > deadline) {
        logger.debug(`[ORCHESTRATOR SHELL] Giving up on ${label} after ${attempt + 1} attempt(s)`, error);
        return;
      }
      await delay(wait);
    }
  }
}

/**
 * Runs the shell tasks the orchestrator dispatches to this machine. Each command runs in its own
 * process group, so cancelling or timing it out stops everything it started. Its stdout and
 * stderr are reported separately when it ends; the finish report is retried until the server has
 * it, and the execution counts as live (for reconciling) until then.
 */
export function createOrchestratorShellExecutor(api: ApiClient) {
  const executions = new Map<string, ShellExecution>();

  const signalProcessGroup = (execution: ShellExecution, signal: NodeJS.Signals) => {
    const pid = execution.child.pid;
    if (pid === undefined) {
      return;
    }
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        process.kill(-pid, signal);
      }
    } catch (error) {
      // ESRCH: everything in the group has exited already
      logger.debug(`[ORCHESTRATOR SHELL] Failed to send ${signal} to execution ${execution.payload.executionId}`, error);
    }
  };

  const terminate = (execution: ShellExecution) => {
    signalProcessGroup(execution, 'SIGTERM');
    setTimeout(() => signalProcessGroup(execution, 'SIGKILL'), SHELL_KILL_GRACE_MS).unref();
  };

  const finish = async (execution: ShellExecution, exitCode: number | null, signal: string | null, spawnError?: Error) => {
    if (execution.finished) {
      return;
    }
    execution.finished = true;
    if (execution.watchdogTimer) {
      clearTimeout(execution.watchdogTimer);
    }
    execution.child.stdout?.destroy();
    execution.child.stderr?.destroy();

    const { payload } = execution;
    const status = spawnError && !execution.cancelRequested && !execution.watchdogTriggered
      ? 'failed'
      : mapFinishStatus({ watchdogTriggered: execution.watchdogTriggered, cancelRequested: execution.cancelRequested, exitCode });
    const stdout = renderCapturedOutput(execution.stdout);
    const stderr = renderCapturedOutput(execution.stderr);
    const error = spawnError
      ? { code: 'SPAWN_ERROR', message: existsSync(execution.cwd) ? spawnError.message : `Working directory not found: ${execution.cwd}` }
      : status === 'timeout'
        ? { code: 'WATCHDOG_TIMEOUT', message: `Command exceeded timeout (${payload.timeoutMs}ms)` }
        : status === 'failed'
          ? { code: 'PROCESS_EXIT_NON_ZERO', message: exitCode !== null ? `Command exited with code ${exitCode}` : `Command was killed by ${signal}` }
          : null;

    await execution.startReport;
    await reportWithRetry(`finish of execution ${payload.executionId}`, () => api.reportOrchestratorExecutionFinish({
      executionId: payload.executionId,
      dispatchToken: payload.dispatchToken,
      status,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal,
      outputSummary: buildOutputSummary(stdout, stderr),
      outputText: stdout,
      stderrText: stderr,
      errorCode: error?.code,
      errorMessage: error?.message,
    }), Infinity);
    executions.delete(payload.executionId);
  };

  return {
    dispatch: async (payload: OrchestratorShellDispatchPayload): Promise<{ accepted: boolean; duplicate?: boolean }> => {
      const existing = executions.get(payload.executionId);
      if (existing) {
        if (existing.payload.dispatchToken !== payload.dispatchToken) {
          throw new Error(`Execution ${payload.executionId} already running with different dispatchToken`);
        }
        return { accepted: true, duplicate: true };
      }

      const cwd = (payload.workingDirectory?.trim() || os.homedir()).replace(/^~(?=$|[\\/])/, os.homedir());
      const child = spawn(remoteShell.file, remoteShell.args(payload.prompt), {
        cwd,
        // Its own process group, to signal everything the command starts
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env,
      });
      const startedAt = new Date().toISOString();
      const execution: ShellExecution = {
        payload,
        child,
        cwd,
        cancelRequested: false,
        watchdogTriggered: false,
        finished: false,
        stdout: { head: '', tail: '', omitted: 0 },
        stderr: { head: '', tail: '', omitted: 0 },
        startReport: reportWithRetry(`start of execution ${payload.executionId}`, () => api.reportOrchestratorExecutionStart({
          executionId: payload.executionId,
          dispatchToken: payload.dispatchToken,
          startedAt,
          pid: child.pid,
        }), Date.now() + START_REPORT_DEADLINE_MS),
        watchdogTimer: payload.timeoutMs === null ? null : setTimeout(() => {
          execution.watchdogTriggered = true;
          terminate(execution);
        }, payload.timeoutMs),
      };
      executions.set(payload.executionId, execution);

      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => captureChunk(execution.stdout, chunk));
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => captureChunk(execution.stderr, chunk));
      child.once('error', (error) => void finish(execution, null, null, error));
      child.once('exit', (code, signal) => {
        setTimeout(() => void finish(execution, code, signal), SHELL_OUTPUT_DRAIN_MS);
      });
      child.once('close', (code, signal) => void finish(execution, code, signal));
      logger.debug(`[ORCHESTRATOR SHELL] Started execution ${payload.executionId} (pid ${child.pid}) in ${cwd}`);
      return { accepted: true };
    },

    /** Cancel a running command; `null` if it is not one of the shell executions. */
    cancel: (payload: OrchestratorCancelPayload): { accepted: boolean } | null => {
      const execution = executions.get(payload.executionId);
      if (!execution) {
        return null;
      }
      if (execution.payload.dispatchToken !== payload.dispatchToken) {
        throw new Error(`dispatchToken mismatch for execution ${payload.executionId}`);
      }
      execution.cancelRequested = true;
      terminate(execution);
      return { accepted: true };
    },

    liveExecutionIds: () => [...executions.keys()],

    /** Stop every command (the daemon is shutting down), waiting a while for their reports. */
    stopAll: async () => {
      for (const execution of executions.values()) {
        execution.cancelRequested = true;
        terminate(execution);
      }
      const deadline = Date.now() + SHELL_SHUTDOWN_WAIT_MS;
      while (executions.size > 0 && Date.now() < deadline) {
        await delay(100);
      }
    },
  };
}

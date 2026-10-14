/**
 * Helper processes started for one short exchange, such as asking an agent CLI
 * for its models.
 *
 * The process gets its own process group, so ending it also ends whatever it
 * started (hooks, MCP servers), and it is always ended once the exchange
 * settles: SIGTERM to the group, then SIGKILL to whatever is still there after
 * a grace period.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { basename } from 'node:path';
import type { Readable, Writable } from 'node:stream';

const KILL_GRACE_MS = 2_000;

export type ShortLivedProcess = ChildProcessByStdio<Writable, Readable, null>;

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is gone already
  }
}

function endProcessGroup(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    return;
  }
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
}

/**
 * Starts `command`, hands it to `run` and returns what `run` returns. Rejects if
 * the process fails to start, exits first, or `timeoutMs` passes.
 */
export async function withShortLivedProcess<T>(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  run: (child: ShortLivedProcess) => Promise<T>,
): Promise<T> {
  const name = basename(command);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
    windowsHide: true,
  });
  let timer: NodeJS.Timeout | undefined;
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`${name} exited with ${signal ?? `code ${code}`}`)));
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), options.timeoutMs);
  });

  try {
    return await Promise.race([run(child), failed]);
  } finally {
    clearTimeout(timer);
    if (child.pid !== undefined) endProcessGroup(child.pid);
  }
}

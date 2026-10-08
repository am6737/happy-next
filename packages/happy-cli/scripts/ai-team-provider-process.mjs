import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const processInfo = (pid) => {
  try {
    const directory = `/proc/${pid}`;
    if (statSync(directory).uid !== process.getuid()) return null;
    const stat = readFileSync(join(directory, 'stat'), 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const cmd = readFileSync(join(directory, 'cmdline')).toString('utf8').split('\0').filter(Boolean);
    const children = readFileSync(join(directory, 'task', String(pid), 'children'), 'utf8')
      .trim().split(/\s+/).filter(Boolean).map(Number);
    return { pid, state: fields[0], startTime: fields[19], cmd, children,
      cwd: readlinkSync(join(directory, 'cwd')) };
  } catch { return null; }
};

const descendants = (rootPid) => {
  const found = [];
  const pending = [rootPid];
  const seen = new Set();
  while (pending.length && seen.size < 100) {
    const pid = pending.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const item = processInfo(pid);
    if (!item) continue;
    found.push(item);
    pending.push(...item.children);
  }
  return found;
};

const isProvider = (item, provider) => {
  if (provider === 'claude') return item.cmd.some((arg) => /(?:^|\/)(?:claude(?:\.js)?|claude_local_launcher\.cjs)$/.test(arg))
    && item.cmd.includes('--output-format') && item.cmd.includes('stream-json');
  if (provider === 'codex-app-server') return item.cmd.some((arg) => /(?:^|\/)codex(?:\.js)?$/.test(arg))
    && item.cmd.includes('app-server');
  return item.cmd.some((arg) => /(?:^|\/)codex(?:\.js)?$/.test(arg))
    && item.cmd.includes('exec') && item.cmd.includes('--json');
};

export async function observeProvider(db, runId, provider, deadlineMs = 120_000, localWorkspace = null) {
  const until = Date.now() + deadlineMs;
  let trustedWorktree = null;
  const workspaceForTask = (taskId) => {
    if (!localWorkspace) return null;
    if (trustedWorktree) return trustedWorktree;
    const key = createHash('sha256').update(taskId).digest('hex');
    const file = join(localWorkspace.root, `task-${key}.json`);
    if (!existsSync(file)) return null;
    if (!lstatSync(file).isFile() || (lstatSync(file).mode & 0o077))
      throw new Error('Trusted task workspace record has unsafe permissions');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const expected = join(localWorkspace.root, `task-${key}`);
    const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 }).trim();
    if (saved.taskId !== taskId || saved.repository !== realpathSync(localWorkspace.repository)
      || saved.worktreePath !== expected
      || saved.branchName !== `happy-agent/${key.slice(0, 24)}`
      || typeof saved.baseCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(saved.baseCommit))
      throw new Error('Trusted task workspace identity changed');
    if (!existsSync(expected)) return null;
    if (realpathSync(saved.worktreePath) !== expected
      || realpathSync(git(saved.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
        !== realpathSync(git(saved.repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
      || git(saved.worktreePath, ['branch', '--show-current']) !== saved.branchName)
      throw new Error('Trusted task workspace identity changed');
    trustedWorktree = expected;
    return trustedWorktree;
  };
  const evidence = { runningSamples: 0, descendantSamples: 0, worktreeMatches: 0,
    launcherNames: 0, streamJsonShapes: 0, lastStatus: 'none' };
  while (Date.now() < until) {
    const execution = await db.orchestratorExecution.findFirst({ where: { runId },
      select: { id: true, taskId: true, status: true, pid: true, worktreePath: true } });
    const worktreePath = execution?.worktreePath ?? (execution?.taskId ? workspaceForTask(execution.taskId) : null);
    if (execution?.pid && worktreePath) {
      const tree = descendants(execution.pid);
      evidence.lastStatus = execution.status;
      if (execution.status === 'running') {
        evidence.runningSamples++;
        evidence.descendantSamples += Math.max(0, tree.length - 1);
        evidence.worktreeMatches += tree.filter((item) => item.pid !== execution.pid
          && item.cwd === worktreePath).length;
        evidence.launcherNames += tree.filter((item) => item.cmd.some((arg) =>
          /(?:^|\/)claude_local_launcher\.cjs$/.test(arg))).length;
        evidence.streamJsonShapes += tree.filter((item) => item.cmd.includes('--output-format')
          && item.cmd.includes('stream-json')).length;
      }
      const providerProcess = tree.find((item) => isProvider(item, provider)
        && item.cwd === worktreePath && item.pid !== execution.pid);
      if (providerProcess && execution.status === 'running') {
        return { executionId: execution.id, worktreePath,
          oneShot: { pid: execution.pid, startTime: tree[0]?.startTime },
          provider: { pid: providerProcess.pid, startTime: providerProcess.startTime },
          observedProcesses: tree.map(({ pid, startTime }) => ({ pid, startTime })) };
      }
    }
    if (execution && ['completed', 'failed', 'cancelled', 'timeout'].includes(execution.status)) {
      evidence.lastStatus = execution.status;
      break;
    }
    await delay(50);
  }
  throw new Error(`Actual provider process was not observed while original execution ran: ${JSON.stringify(evidence)}`);
}

export async function assertObservedProcessesExited(observed) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (observed.observedProcesses.every(({ pid, startTime }) => {
      const current = processInfo(pid);
      return !current || current.startTime !== startTime || current.state === 'Z';
    })) return;
    await delay(100);
  }
  const remaining = observed.observedProcesses.filter(({ pid, startTime }) => {
    const current = processInfo(pid);
    return current && current.startTime === startTime && current.state !== 'Z';
  });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const { pid, startTime } of remaining) {
      const current = processInfo(pid);
      if (current?.startTime !== startTime || current.cwd !== observed.worktreePath) continue;
      try { process.kill(pid, signal); } catch { /* Exited after the identity check. */ }
    }
    await delay(signal === 'SIGTERM' ? 1000 : 100);
  }
  throw new Error(`Observed provider process remained after execution termination: ${remaining
    .map(({ pid }) => pid === observed.provider.pid ? 'provider' : pid === observed.oneShot.pid
      ? 'one-shot' : 'descendant').join(',')}`);
}

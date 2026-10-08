import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { acquireFileLock } from './fileLock';

export type ExecutionWorkspace = { worktreePath: string; branchName: string; baseCommit: string; repository: string; taskId: string };
const key = (value: string) => createHash('sha256').update(value).digest('hex');
function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitRefExists(cwd: string, ref: string) {
  try { git(cwd, ['show-ref', '--verify', '--quiet', ref]); return true; }
  catch { return false; }
}
function recordPath(root: string, kind: 'task' | 'session', id: string) { return join(root, `${kind}-${key(id)}.json`); }
function atomicRecord(path: string, value: ExecutionWorkspace) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
async function locked<T>(root: string, operation: () => T): Promise<T> {
  mkdirSync(root, { recursive: true });
  const lock = await acquireFileLock(join(root, '.workspace.lock'), 10);
  try { return operation(); } finally { await lock.release(); }
}
function validate(saved: ExecutionWorkspace, repository: string, taskId: string): ExecutionWorkspace {
  if (saved.repository !== repository || saved.taskId !== taskId || !existsSync(saved.worktreePath)
    || realpathSync(git(saved.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) !== realpathSync(git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
    || git(saved.worktreePath, ['branch', '--show-current']) !== saved.branchName) {
    throw new Error('Saved execution workspace identity changed; refusing to resume');
  }
  git(saved.worktreePath, ['merge-base', '--is-ancestor', saved.baseCommit, 'HEAD']);
  return saved;
}

export async function prepareExecutionWorkspace(root: string, source: string, taskId: string, childSessionId?: string): Promise<ExecutionWorkspace> {
  let repository: string;
  try { repository = realpathSync(git(source, ['rev-parse', '--show-toplevel'])); }
  catch { throw new Error(`Source is not an accessible Git checkout: ${source}`); }
  return locked(root, () => {
    const taskRecord = recordPath(root, 'task', taskId);
    if (childSessionId) {
      const sessionRecord = recordPath(root, 'session', childSessionId);
      if (!existsSync(sessionRecord)) throw new Error('No workspace is registered for this child session on this runtime');
      const saved = validate(JSON.parse(readFileSync(sessionRecord, 'utf8')) as ExecutionWorkspace, repository, taskId);
      if (!existsSync(taskRecord) || JSON.stringify(JSON.parse(readFileSync(taskRecord, 'utf8'))) !== JSON.stringify(saved))
        throw new Error('Task and session workspace records disagree');
      return saved;
    }
    if (existsSync(taskRecord)) {
      const saved = JSON.parse(readFileSync(taskRecord, 'utf8')) as ExecutionWorkspace;
      if (!existsSync(saved.worktreePath) && saved.repository === repository && saved.taskId === taskId) {
        const branchRef = `refs/heads/${saved.branchName}`;
        const branchExists = gitRefExists(repository, branchRef);
        // show-ref --quiet exits 1 when absent; use the exact ref before restoring.
        if (branchExists) {
          if (git(repository, ['rev-parse', branchRef]) !== saved.baseCommit) throw new Error('Pending workspace branch moved; manual inspection required');
          const registered = git(repository, ['worktree', 'list', '--porcelain']);
          const registeredPath = registered.split('\n\n').find((entry) => entry.split('\n').includes(`branch ${branchRef}`))?.split('\n')[0]?.slice(9);
          if (registeredPath && registeredPath !== saved.worktreePath) throw new Error('Pending workspace branch belongs to another worktree');
          git(repository, ['worktree', 'add', ...(registeredPath ? ['--force'] : []), saved.worktreePath, saved.branchName]);
        } else git(repository, ['worktree', 'add', '-b', saved.branchName, saved.worktreePath, saved.baseCommit]);
      }
      return validate(saved, repository, taskId);
    }
    const branchName = `happy-agent/${key(taskId).slice(0, 24)}`;
    const worktreePath = join(root, `task-${key(taskId)}`);
    if (existsSync(worktreePath)) throw new Error('Unregistered task workspace exists; manual inspection required');
    const baseCommit = git(repository, ['rev-parse', 'HEAD']);
    const saved = { repository, worktreePath, branchName, baseCommit, taskId };
    atomicRecord(taskRecord, saved);
    try { git(repository, ['worktree', 'add', '-b', branchName, worktreePath, baseCommit]); }
    catch (error) { throw new Error(`Unable to create task worktree: ${error instanceof Error ? error.message : String(error)}`); }
    return saved;
  });
}

export async function rememberWorkspaceSession(root: string, childSessionId: string, workspace: ExecutionWorkspace): Promise<void> {
  await locked(root, () => {
    const path = recordPath(root, 'session', childSessionId);
    if (existsSync(path) && JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(workspace))
      throw new Error('Session is already bound to another task workspace');
    atomicRecord(path, workspace);
  });
}

export function loadExecutionWorkspace(root: string, repository: string, taskId: string): ExecutionWorkspace {
  const path = recordPath(root, 'task', taskId);
  if (!existsSync(path)) throw new Error('Trusted task workspace record is unavailable');
  return validate(JSON.parse(readFileSync(path, 'utf8')) as ExecutionWorkspace, realpathSync(repository), taskId);
}

export function loadLocalExecutionWorkspace(root: string, taskId: string): ExecutionWorkspace {
  const path = recordPath(root, 'task', taskId);
  if (!existsSync(path)) throw new Error('Trusted task workspace record is unavailable');
  const saved = JSON.parse(readFileSync(path, 'utf8')) as ExecutionWorkspace;
  if (saved.taskId !== taskId || !saved.repository || !saved.worktreePath || !saved.branchName || !saved.baseCommit)
    throw new Error('Invalid trusted task workspace record');
  return validate(saved, saved.repository, taskId);
}

export async function previewExecutionWorkspaceGc(root: string, acceptedTaskIds: ReadonlySet<string>, retentionMs: number): Promise<ExecutionWorkspace[]> {
  if (retentionMs < 0) throw new Error('GC retention must be non-negative');
  if (!existsSync(root)) return [];
  const candidates: ExecutionWorkspace[] = [];
  for (const file of readdirSync(root).filter((name) => name.startsWith('task-') && name.endsWith('.json'))) {
    const path = join(root, file);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as ExecutionWorkspace;
    if (!acceptedTaskIds.has(saved.taskId) || Date.now() - statSync(path).mtimeMs < retentionMs) continue;
    let lease;
    try {
      lease = await acquireFileLock(`${saved.worktreePath}.execution.lock`);
      validate(saved, saved.repository, saved.taskId);
      if (git(saved.worktreePath, ['status', '--porcelain', '--untracked-files=all']) !== '') continue;
      candidates.push(saved);
    } catch { /* Invalid, missing, or actively owned workspaces are never GC candidates. */ }
    finally { await lease?.release(); }
  }
  return candidates;
}

export function commitExecutionWorkspace(workspace: ExecutionWorkspace): string {
  validate(workspace, workspace.repository, workspace.taskId);
  if (git(workspace.worktreePath, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    git(workspace.worktreePath, ['add', '--all']);
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Happy Agent', '-c', 'user.email=agent@happy-next.local',
      'commit', '-m', `Complete task ${workspace.taskId}`], {
      cwd: workspace.worktreePath, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return git(workspace.worktreePath, ['rev-parse', 'HEAD']);
}

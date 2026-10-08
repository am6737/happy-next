import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalExecutionWorkspace } from './workspace';
import { currentBranch, matchingChangedEntries } from './gitTree';

type Member = { taskId: string; machineId: string; branchName: string; commitSha: string; baseCommit: string };
type Expected = { runId: string; taskId: string; executionId: string; machineId: string;
  aggregateCommit: string; baseCommit: string; members: Member[] };
type Request = { executionId: string; dispatchToken: string; expectedHash: string; expected: unknown; proof: unknown };
type Binding = { executionId: string; dispatchToken: string; taskId: string; runId: string };
function bindingPath(root: string, executionId: string): string {
  return join(root, `integration-${createHash('sha256').update(executionId).digest('hex')}.json`);
}
export function saveIntegrationBinding(root: string, binding: Binding): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = bindingPath(root, binding.executionId);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(binding), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
export function matchesIntegrationBinding(root: string, binding: Binding): boolean {
  try {
    const saved = JSON.parse(readFileSync(bindingPath(root, binding.executionId), 'utf8')) as Binding;
    return saved.executionId === binding.executionId && saved.dispatchToken === binding.dispatchToken
      && saved.taskId === binding.taskId && saved.runId === binding.runId;
  } catch { return false; }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function validSha(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value); }
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function reject(errorCode: string): { verified: false; errorCode: string } { return { verified: false, errorCode }; }

export function verifyIntegrationRequest(root: string, machineId: string, request: Request,
  isKnownExecution: (executionId: string, token: string, taskId: string, runId: string) => boolean):
  { verified: true; expectedHash: string } | { verified: false; errorCode: string } {
  const expected = request.expected as Expected;
  if (!expected || !validId(expected.runId) || !validId(expected.taskId)
    || expected.executionId !== request.executionId || expected.machineId !== machineId
    || !validSha(expected.aggregateCommit) || !validSha(expected.baseCommit)
    || !Array.isArray(expected.members) || expected.members.length < 2 || expected.members.length > 64
    || !expected.members.every((m) => validId(m.taskId) && validId(m.machineId)
      && validId(m.branchName) && validSha(m.commitSha) && validSha(m.baseCommit))
    || new Set(expected.members.map((m) => m.taskId)).size !== expected.members.length
    || !validSha(request.expectedHash)
    || createHash('sha256').update(JSON.stringify(canonical(expected))).digest('hex') !== request.expectedHash
    || !isKnownExecution(request.executionId, request.dispatchToken, expected.taskId, expected.runId))
    return reject('identity_changed');
  try {
    const aggregate = loadLocalExecutionWorkspace(root, expected.taskId);
    const common = realpathSync(git(aggregate.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    if (aggregate.baseCommit !== expected.baseCommit
      || currentBranch(aggregate.worktreePath) !== aggregate.branchName
      || git(aggregate.worktreePath, ['rev-parse', 'HEAD']) !== expected.aggregateCommit
      || git(aggregate.worktreePath, ['status', '--porcelain', '--untracked-files=all'])) return reject('identity_changed');
    git(aggregate.worktreePath, ['merge-base', '--is-ancestor', expected.baseCommit, expected.aggregateCommit]);
    const worktrees = new Set([aggregate.worktreePath]);
    const branches = new Set([aggregate.branchName]);
    for (const member of expected.members) {
      // A member on another machine cannot be verified from this machine's account workspace.
      if (member.machineId !== machineId || member.baseCommit !== expected.baseCommit) return reject('identity_changed');
      const child = loadLocalExecutionWorkspace(root, member.taskId);
      if (child.worktreePath === aggregate.worktreePath || child.repository !== aggregate.repository
        || child.baseCommit !== member.baseCommit || child.branchName !== member.branchName
        || worktrees.has(child.worktreePath) || branches.has(child.branchName)
        || currentBranch(child.worktreePath) !== child.branchName
        || realpathSync(git(child.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) !== common
        || git(child.worktreePath, ['rev-parse', 'HEAD']) !== member.commitSha
        || git(child.worktreePath, ['status', '--porcelain', '--untracked-files=all'])) return reject('identity_changed');
      worktrees.add(child.worktreePath);
      branches.add(child.branchName);
      git(child.worktreePath, ['merge-base', '--is-ancestor', member.baseCommit, member.commitSha]);
      const missing = git(child.worktreePath, ['cherry', expected.aggregateCommit, member.commitSha, member.baseCommit]);
      if (missing.split('\n').some((line) => line.startsWith('+ '))) return reject('patch_missing');
      if (!matchingChangedEntries(child.worktreePath, aggregate.worktreePath,
        member.baseCommit, member.commitSha, expected.aggregateCommit)) return reject('file_mismatch');
    }
    return { verified: true, expectedHash: request.expectedHash };
  } catch { return reject('identity_changed'); }
}

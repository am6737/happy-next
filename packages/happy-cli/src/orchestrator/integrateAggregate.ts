import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { ApiClient } from '@/api/api';
import { loadExecutionWorkspace, type ExecutionWorkspace } from './workspace';
import type { OrchestratorDispatchPayload } from './common';
import { currentBranch, matchingChangedEntries } from './gitTree';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function common(cwd: string): string {
  return realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}
export type IntegratedIdentity = { taskId: string; branchName: string; sourceCommit: string; integratedCommit: string };

export async function integrateAggregate(api: ApiClient, payload: OrchestratorDispatchPayload,
  aggregate: ExecutionWorkspace, root: string): Promise<IntegratedIdentity[]> {
  if (payload.integrationPolicy !== 'review_and_cherry_pick') throw new Error('Unsupported integration policy');
  if (payload.permissionMode !== 'guarded_auto') throw new Error('Aggregate integration requires guarded_auto');
  const tasks = await api.getOrchestratorRunTasks(payload.runId);
  const current = tasks.find((task) => task.taskId === payload.taskId);
  if (!current || !Array.isArray(current.dependsOn)) throw new Error('Aggregate task is not present in trusted run');
  const keys = [...new Set(current.dependsOn)].filter((key) => key !== 'primary');
  if (keys.length < 2) throw new Error('Aggregate requires at least two completed member tasks');
  if (git(aggregate.repository, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Source repository is dirty');
  if (git(aggregate.worktreePath, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Aggregate worktree is dirty');
  const identities: IntegratedIdentity[] = [];
  const worktrees = new Set([aggregate.worktreePath]);
  const branches = new Set([aggregate.branchName]);
  const repositoryCommon = common(aggregate.repository);
  if (currentBranch(aggregate.worktreePath) !== aggregate.branchName) throw new Error('Aggregate branch identity changed');
  for (const key of keys) {
    const task = tasks.find((candidate) => candidate.taskKey === key);
    if (!task || task.status !== 'completed') throw new Error('Member task is not completed');
    const child = loadExecutionWorkspace(root, aggregate.repository, task.taskId);
    if (child.worktreePath === aggregate.worktreePath || child.baseCommit !== aggregate.baseCommit
      || worktrees.has(child.worktreePath) || branches.has(child.branchName)
      || currentBranch(child.worktreePath) !== child.branchName
      || common(child.worktreePath) !== repositoryCommon) throw new Error('Member Git identity differs from aggregate');
    worktrees.add(child.worktreePath);
    branches.add(child.branchName);
    if (git(child.worktreePath, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Member worktree is dirty');
    const sourceCommit = git(child.worktreePath, ['rev-parse', 'HEAD']);
    if (sourceCommit === child.baseCommit) throw new Error('Member has no commit to integrate');
    git(child.worktreePath, ['merge-base', '--is-ancestor', child.baseCommit, sourceCommit]);
    const commits = git(child.worktreePath, ['rev-list', '--reverse', `${child.baseCommit}..${sourceCommit}`]).split('\n').filter(Boolean);
    for (const commit of commits) {
      try {
        git(aggregate.worktreePath, ['-c', 'core.hooksPath=/dev/null', 'cherry-pick', commit]);
      } catch { throw new Error(`Integration conflict for member task ${task.taskId}`); }
    }
    const integratedCommit = git(aggregate.worktreePath, ['rev-parse', 'HEAD']);
    const missing = git(child.worktreePath, ['cherry', integratedCommit, sourceCommit, child.baseCommit]);
    if (missing.split('\n').some((line) => line.startsWith('+ '))) throw new Error('Member patch is missing after integration');
    identities.push({ taskId: task.taskId, branchName: child.branchName, sourceCommit, integratedCommit });
  }
  return identities;
}

export function verifyAggregateIntegration(aggregate: ExecutionWorkspace, root: string, identities: IntegratedIdentity[]): void {
  if (identities.length < 2) throw new Error('Insufficient integrated members');
  const head = git(aggregate.worktreePath, ['rev-parse', 'HEAD']);
  if (currentBranch(aggregate.worktreePath) !== aggregate.branchName) throw new Error('Aggregate branch identity changed');
  if (git(aggregate.worktreePath, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Aggregate has uncommitted changes');
  const worktrees = new Set([aggregate.worktreePath]);
  const branches = new Set([aggregate.branchName]);
  for (const identity of identities) {
    const child = loadExecutionWorkspace(root, aggregate.repository, identity.taskId);
    if (child.branchName !== identity.branchName || worktrees.has(child.worktreePath)
      || branches.has(child.branchName) || currentBranch(child.worktreePath) !== child.branchName
      || common(child.worktreePath) !== common(aggregate.worktreePath)
      || git(child.worktreePath, ['rev-parse', 'HEAD']) !== identity.sourceCommit)
      throw new Error('Integrated member identity changed');
    worktrees.add(child.worktreePath);
    branches.add(child.branchName);
    const missing = git(child.worktreePath, ['cherry', head, identity.sourceCommit, child.baseCommit]);
    if (missing.split('\n').some((line) => line.startsWith('+ '))) throw new Error('Aggregate is missing a member patch');
    if (!matchingChangedEntries(child.worktreePath, aggregate.worktreePath,
      child.baseCommit, identity.sourceCommit, head))
      throw new Error('Aggregate committed file bytes or mode differ from member');
  }
}

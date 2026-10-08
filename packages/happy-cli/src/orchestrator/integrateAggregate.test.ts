import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/api/api';
import { integrateAggregate, verifyAggregateIntegration } from './integrateAggregate';
import { commitExecutionWorkspace, prepareExecutionWorkspace } from './workspace';

describe('aggregate Git integration', () => {
  it('cherry-picks two trusted member workspaces and rejects missing patches', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-aggregate-'));
    const repo = join(directory, 'repo');
    const root = join(directory, 'workspaces');
    const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(repo, ['config', 'user.name', 'Test']); git(repo, ['config', 'user.email', 'test@example.invalid']);
      writeFileSync(join(repo, 'README.md'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
      const alpha = await prepareExecutionWorkspace(root, repo, 'alpha');
      const beta = await prepareExecutionWorkspace(root, repo, 'beta');
      const aggregate = await prepareExecutionWorkspace(root, repo, 'aggregate');
      writeFileSync(join(alpha.worktreePath, 'alpha.txt'), 'alpha\n'); commitExecutionWorkspace(alpha);
      writeFileSync(join(beta.worktreePath, 'beta.txt'), 'beta\n'); commitExecutionWorkspace(beta);
      const api = { getOrchestratorRunTasks: async () => [
        { taskId: 'alpha', taskKey: 'delegate:alpha', status: 'completed', dependsOn: [] },
        { taskId: 'beta', taskKey: 'delegate:beta', status: 'completed', dependsOn: [] },
        { taskId: 'aggregate', taskKey: 'aggregate', status: 'running', dependsOn: ['primary', 'delegate:alpha', 'delegate:beta'] },
      ] } as unknown as ApiClient;
      const payload = { runId: 'run', taskId: 'aggregate', integrationPolicy: 'review_and_cherry_pick' as const,
        permissionMode: 'guarded_auto' as const, executionId: 'execution', dispatchToken: 'token', provider: 'codex' as const,
        executionType: 'initial' as const, prompt: 'review', timeoutMs: 1000 };
      const identities = await integrateAggregate(api, payload, aggregate, root);
      expect(identities).toHaveLength(2);
      expect(git(aggregate.worktreePath, ['show', 'HEAD:beta.txt'])).toBe('beta');
      verifyAggregateIntegration(aggregate, root, identities);
      git(aggregate.worktreePath, ['revert', '--no-edit', identities[1].integratedCommit]);
      expect(() => verifyAggregateIntegration(aggregate, root, identities)).toThrow(/member patch|file bytes/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('stops on a real cherry-pick conflict without deleting either member worktree', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-aggregate-conflict-'));
    const repo = join(directory, 'repo');
    const root = join(directory, 'workspaces');
    const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(repo, ['config', 'user.name', 'Test']); git(repo, ['config', 'user.email', 'test@example.invalid']);
      writeFileSync(join(repo, 'shared.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
      const alpha = await prepareExecutionWorkspace(root, repo, 'alpha');
      const beta = await prepareExecutionWorkspace(root, repo, 'beta');
      const aggregate = await prepareExecutionWorkspace(root, repo, 'aggregate');
      writeFileSync(join(alpha.worktreePath, 'shared.txt'), 'alpha\n'); commitExecutionWorkspace(alpha);
      writeFileSync(join(beta.worktreePath, 'shared.txt'), 'beta\n'); commitExecutionWorkspace(beta);
      const api = { getOrchestratorRunTasks: async () => [
        { taskId: 'alpha', taskKey: 'delegate:alpha', status: 'completed', dependsOn: [] },
        { taskId: 'beta', taskKey: 'delegate:beta', status: 'completed', dependsOn: [] },
        { taskId: 'aggregate', taskKey: 'aggregate', status: 'running', dependsOn: ['primary', 'delegate:alpha', 'delegate:beta'] },
      ] } as unknown as ApiClient;
      await expect(integrateAggregate(api, { runId: 'run', taskId: 'aggregate', integrationPolicy: 'review_and_cherry_pick',
        permissionMode: 'guarded_auto', executionId: 'execution', dispatchToken: 'token', provider: 'codex',
        executionType: 'initial', prompt: 'review', timeoutMs: 1000 }, aggregate, root)).rejects.toThrow('Integration conflict');
      expect(git(alpha.worktreePath, ['status', '--porcelain'])).toBe('');
      expect(git(beta.worktreePath, ['status', '--porcelain'])).toBe('');
      expect(git(aggregate.worktreePath, ['status', '--porcelain'])).not.toBe('');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

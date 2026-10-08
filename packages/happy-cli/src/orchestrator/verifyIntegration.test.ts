import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { integrateAggregate } from './integrateAggregate';
import { commitExecutionWorkspace, prepareExecutionWorkspace } from './workspace';
import { matchesIntegrationBinding, saveIntegrationBinding, verifyIntegrationRequest } from './verifyIntegration';
import type { ApiClient } from '@/api/api';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
describe('read-only integration RPC', () => {
  it('verifies two local members and rejects changed identity, missing patch, and fake proof', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-verify-integration-'));
    const repo = join(directory, 'repo'); const root = join(directory, 'workspaces');
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
      await integrateAggregate(api, { runId: 'run', taskId: 'aggregate', integrationPolicy: 'review_and_cherry_pick',
        permissionMode: 'guarded_auto', executionId: 'execution', dispatchToken: 'token', provider: 'codex',
        executionType: 'initial', prompt: 'review', timeoutMs: 1000 }, aggregate, root);
      const expected = { runId: 'run', taskId: 'aggregate', executionId: 'execution', machineId: 'machine',
        aggregateCommit: git(aggregate.worktreePath, ['rev-parse', 'HEAD']), baseCommit: aggregate.baseCommit,
        members: [alpha, beta].map((item) => ({ taskId: item.taskId, machineId: 'machine',
          branchName: item.branchName, commitSha: git(item.worktreePath, ['rev-parse', 'HEAD']), baseCommit: item.baseCommit })) };
      const expectedHash = createHash('sha256').update(JSON.stringify(canonical(expected))).digest('hex');
      saveIntegrationBinding(root, { executionId: 'execution', dispatchToken: 'token', taskId: 'aggregate', runId: 'run' });
      const verify = (snapshot: typeof expected, proof: unknown = {}) => verifyIntegrationRequest(root, 'machine', {
        executionId: 'execution', dispatchToken: 'token', expectedHash: createHash('sha256')
          .update(JSON.stringify(canonical(snapshot))).digest('hex'), expected: snapshot, proof,
      }, (executionId, dispatchToken, taskId, runId) => matchesIntegrationBinding(root,
        { executionId, dispatchToken, taskId, runId }));
      expect(verify(expected)).toEqual({ verified: true, expectedHash });
      expect(verify(expected, { members: [] })).toEqual({ verified: true, expectedHash });
      expect(verify({ ...expected, members: [expected.members[0]] })).toEqual({ verified: false, errorCode: 'identity_changed' });
      expect(verify({ ...expected, members: expected.members.map((m) => ({ ...m, machineId: 'other' })) }))
        .toEqual({ verified: false, errorCode: 'identity_changed' });
      git(aggregate.worktreePath, ['revert', '--no-edit', 'HEAD']);
      expect(verify({ ...expected, aggregateCommit: git(aggregate.worktreePath, ['rev-parse', 'HEAD']) }))
        .toEqual({ verified: false, errorCode: 'file_mismatch' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

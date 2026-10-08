import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ApiClient } from '@/api/api';
import { prepareExecutionWorkspace } from './workspace';
import { requestApproval } from './approvalJournal';
import { saveExecutionCapability } from './executionCapability';
import { recoverInterruptedApprovals } from './approvalCrashRecovery';

it.each(['requested', 'invoking'] as const)('queues a bounded failure for an interrupted %s approval', async (state) => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-crash-'));
  const repo = join(root, 'repo');
  const workspaceRoot = join(root, 'workspaces');
  const approvalRoot = join(root, 'approvals');
  const capabilityRoot = join(root, 'capabilities');
  const finishRoot = join(root, 'finishes');
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  try {
    mkdirSync(repo); git(['init', '-q']); git(['config', 'user.name', 'Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(repo, 'README'), 'base\n'); git(['add', '--all']); git(['commit', '-q', '-m', 'base']);
    const workspace = await prepareExecutionWorkspace(workspaceRoot, repo, 'task-1');
    const token = 'dispatch-token';
    const operationId = hash('operation');
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    await requestApproval(approvalRoot, { decisionId: 'decision-1', executionId: 'execution-1',
      taskId: 'task-1', runId: 'run-1', machineId: 'machine-1',
      dispatchTokenHash: hash(token), operationId, actionType: 'shell', actionHash: hash('action'),
      childSessionId: 'session-1234', worktreePathHash: hash(workspace.worktreePath),
      branchName: workspace.branchName, requestVersion: 1, expiresAt,
      state: 'requested', decisionVersion: null });
    if (state === 'invoking') {
      const file = join(approvalRoot, `${hash(`execution-1\0${operationId}`)}.json`);
      const row = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...row, state: 'invoking', decisionVersion: 2 }));
    }
    await saveExecutionCapability(capabilityRoot, 'execution-1', token, {
      token: 'a'.repeat(64), protocolVersion: 1, allowedOps: ['finish'],
      expiresAt: new Date(Date.now() + 600_000).toISOString() });
    const api = { getOrchestratorRecoveryExecution: async () => ({ status: 'running',
      machineId: 'machine-1', childSessionId: 'session-1234', provider: 'codex', latest: true }) } as unknown as ApiClient;
    expect(await recoverInterruptedApprovals({ api, approvalRoot, capabilityRoot,
      workspaceRoot, finishRoot, machineId: 'machine-1' })).toEqual({ queued: 1, review: 0 });
    const reports = readdirSync(finishRoot).filter((name) => name.endsWith('.json'));
    expect(reports).toHaveLength(1);
    const report = JSON.parse(readFileSync(join(finishRoot, reports[0]), 'utf8'));
    expect(report).toMatchObject({ executionId: 'execution-1', dispatchToken: token,
      status: 'failed', errorCode: state === 'invoking'
        ? 'APPROVAL_OUTCOME_UNCERTAIN' : 'APPROVAL_SESSION_INTERRUPTED',
      childSessionId: 'session-1234', branchName: workspace.branchName });
    expect(report.finalResponse).toBeUndefined();
    expect(report.commitSha).toBeUndefined();
    const wrong = await recoverInterruptedApprovals({ api, approvalRoot, capabilityRoot,
      workspaceRoot, finishRoot: join(root, 'wrong-finishes'), machineId: 'other-machine' });
    expect(wrong).toEqual({ queued: 0, review: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiClient } from '@/api/api';
import { acquireFileLock } from './fileLock';
import { enqueueFinish } from './finishQueue';
import { loadExecutionCapability } from './executionCapability';
import { loadLocalExecutionWorkspace } from './workspace';
import type { ApprovalOperation } from './approvalJournal';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function recoverInterruptedApprovals(input: {
  api: ApiClient; approvalRoot: string; capabilityRoot: string;
  workspaceRoot: string; finishRoot: string; machineId: string;
}): Promise<{ queued: number; review: number }> {
  let names: string[];
  try { names = await readdir(input.approvalRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { queued: 0, review: 0 }; throw error; }
  const groups = new Map<string, ApprovalOperation[]>();
  for (const name of names.filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry))) {
    const row = JSON.parse(await readFile(join(input.approvalRoot, name), 'utf8')) as ApprovalOperation;
    if (!row.executionId || !row.operationId || name !== `${digest(`${row.executionId}\0${row.operationId}`)}.json`)
      throw new Error('Approval journal identity changed');
    if (row.acceptedFinish) continue;
    groups.set(row.executionId, [...(groups.get(row.executionId) ?? []), row]);
  }
  let queued = 0;
  let review = 0;
  for (const [executionId, operations] of groups) {
    const first = operations[0];
    try {
      if (operations.some((row) => row.taskId !== first.taskId || row.machineId !== first.machineId
        || row.runId !== first.runId
        || row.childSessionId !== first.childSessionId || row.branchName !== first.branchName
        || row.dispatchTokenHash !== first.dispatchTokenHash
        || !/^[0-9a-f]{64}$/.test(row.actionHash) || !Number.isSafeInteger(row.requestVersion)
        || !Number.isFinite(Date.parse(row.expiresAt))
        || (row.decisionVersion !== null && row.decisionVersion !== row.requestVersion + 1)))
        throw new Error('Approval journal operation identity changed');
      if (first.machineId !== input.machineId || !first.runId)
        throw new Error('Approval machine or run identity changed');
      const capability = await loadExecutionCapability(input.capabilityRoot, executionId);
      if (!capability || digest(capability.dispatchToken) !== first.dispatchTokenHash
        || !capability.capability.allowedOps.includes('finish'))
        throw new Error('Approval capability identity changed');
      const workspace = loadLocalExecutionWorkspace(input.workspaceRoot, first.taskId);
      if (digest(workspace.worktreePath) !== first.worktreePathHash)
        throw new Error('Approval worktree changed');
      const lease = await acquireFileLock(`${workspace.worktreePath}.execution.lock`, 0);
      try {
        const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
          cwd: workspace.worktreePath, encoding: 'utf8', timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        if (branch !== first.branchName || branch !== workspace.branchName)
          throw new Error('Approval branch changed');
        const server = await input.api.getOrchestratorRecoveryExecution(first.runId, first.executionId, first.taskId);
        if (server.status !== 'running') continue;
        if (server.machineId !== first.machineId || server.childSessionId !== first.childSessionId
          || server.provider !== 'codex' || !server.latest)
          throw new Error('Approval server execution identity changed');
        await enqueueFinish(input.finishRoot, { executionId, dispatchToken: capability.dispatchToken,
          status: 'failed', finishedAt: new Date().toISOString(), exitCode: 1,
          childSessionId: first.childSessionId, worktreePath: workspace.worktreePath,
          branchName: workspace.branchName, baseCommit: workspace.baseCommit,
          errorCode: operations.some((row) => row.state === 'invoking')
            ? 'APPROVAL_OUTCOME_UNCERTAIN' : 'APPROVAL_SESSION_INTERRUPTED',
          errorMessage: 'Approval runner ended before its original operation could complete; review the retained journal' });
        queued++;
      } finally { await lease.release(); }
    } catch { review++; }
  }
  return { queued, review };
}

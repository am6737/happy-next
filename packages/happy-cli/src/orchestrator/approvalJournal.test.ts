import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { acknowledgeApprovalFinish, assertNoUnresolvedApprovals, deliverApproval, readApproval,
  requestApproval, transitionApproval, type ApprovalOperation } from './approvalJournal';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const binding = { taskId: 'task', machineId: 'machine', childSessionId: 'session-1234',
  worktreePath: '/private/worktree', branchName: 'happy-agent/task' };
const operation = (): ApprovalOperation => ({ decisionId: 'decision', executionId: 'execution',
  taskId: binding.taskId, machineId: binding.machineId, dispatchTokenHash: hash('dispatch-token'),
  operationId: 'command-1', actionType: 'shell', actionHash: hash('exact action bytes'),
  childSessionId: binding.childSessionId, worktreePathHash: hash(binding.worktreePath),
  branchName: binding.branchName, requestVersion: 0,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), state: 'requested', decisionVersion: null });

it('binds each decision to its exact operation and never replays invoking after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-'));
  try {
    const row = operation();
    await requestApproval(root, row);
    await requestApproval(root, row);
    await expect(requestApproval(root, { ...row, actionHash: hash('different action') }))
      .rejects.toThrow('identity changed');
    const delivery = { decisionId: row.decisionId, executionId: row.executionId,
      dispatchToken: 'dispatch-token', operationId: row.operationId,
      actionType: row.actionType, actionHash: row.actionHash,
      childSessionId: row.childSessionId, worktreePathHash: row.worktreePathHash,
      branchName: row.branchName, expiresAt: row.expiresAt, version: 1, decision: 'approved' as const };
    expect(await deliverApproval(root, { ...delivery, actionHash: hash('wrong') }, binding)).toBe(false);
    expect(await deliverApproval(root, { ...delivery, dispatchToken: 'wrong' }, binding)).toBe(false);
    expect(await deliverApproval(root, { ...delivery, version: 2 }, binding)).toBe(false);
    expect(await deliverApproval(root, delivery, { ...binding, worktreePath: '/other' })).toBe(false);
    expect(await deliverApproval(root, delivery, binding)).toBe(true);
    expect(await deliverApproval(root, delivery, binding)).toBe(true);
    expect(await deliverApproval(root, { ...delivery, decision: 'rejected' }, binding)).toBe(false);
    expect(await transitionApproval(root, row.executionId, row.operationId, row.actionHash,
      'approved', 'invoking')).toBe(true);
    expect((await readApproval(root, row.executionId, row.operationId))?.state).toBe('invoking');
    expect(await transitionApproval(root, row.executionId, row.operationId, row.actionHash,
      'approved', 'invoking')).toBe(false);
    expect(await deliverApproval(root, delivery, binding)).toBe(true);
    expect((await readApproval(root, row.executionId, row.operationId))?.state).toBe('invoking');
    expect(await transitionApproval(root, row.executionId, row.operationId, row.actionHash,
      'invoking', 'invoked')).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('rejects an expired operation and never accepts a task-wide approval', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-expiry-'));
  try {
    const row = { ...operation(), expiresAt: new Date(Date.now() + 30).toISOString() };
    await requestApproval(root, row);
    await delay(45);
    expect(await deliverApproval(root, { decisionId: row.decisionId, executionId: row.executionId,
      dispatchToken: 'dispatch-token', operationId: row.operationId, actionType: row.actionType,
      actionHash: row.actionHash, childSessionId: row.childSessionId,
      worktreePathHash: row.worktreePathHash, branchName: row.branchName,
      expiresAt: row.expiresAt, version: 1, decision: 'approved' }, binding)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('records a completed invocation after approval expiry without replaying it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-long-'));
  try {
    const row = { ...operation(), expiresAt: new Date(Date.now() + 120).toISOString() };
    await requestApproval(root, row);
    expect(await deliverApproval(root, { decisionId: row.decisionId, executionId: row.executionId,
      dispatchToken: 'dispatch-token', operationId: row.operationId, actionType: row.actionType,
      actionHash: row.actionHash, childSessionId: row.childSessionId,
      worktreePathHash: row.worktreePathHash, branchName: row.branchName,
      expiresAt: row.expiresAt, version: 1, decision: 'approved' }, binding)).toBe(true);
    expect(await transitionApproval(root, row.executionId, row.operationId, row.actionHash,
      'approved', 'invoking')).toBe(true);
    await delay(140);
    expect(await transitionApproval(root, row.executionId, row.operationId, row.actionHash,
      'invoking', 'invoked')).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('blocks dispatch after an uncertain invocation until a completed finish is acknowledged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-recovery-'));
  try {
    const row = operation();
    await requestApproval(root, row);
    expect(await deliverApproval(root, { decisionId: row.decisionId,
      executionId: row.executionId, dispatchToken: 'dispatch-token', operationId: row.operationId,
      actionType: row.actionType, actionHash: row.actionHash, childSessionId: row.childSessionId,
      worktreePathHash: row.worktreePathHash, branchName: row.branchName,
      expiresAt: row.expiresAt, version: 1, decision: 'approved' }, binding)).toBe(true);
    await transitionApproval(root, row.executionId, row.operationId, row.actionHash, 'approved', 'invoking');
    await expect(assertNoUnresolvedApprovals(root, row.taskId)).rejects.toThrow('APPROVAL_RECOVERY_REQUIRED');
    await expect(acknowledgeApprovalFinish(root, row.executionId)).rejects.toThrow('not durably invoked');
    await transitionApproval(root, row.executionId, row.operationId, row.actionHash, 'invoking', 'invoked');
    await expect(assertNoUnresolvedApprovals(root, row.taskId)).rejects.toThrow('APPROVAL_RECOVERY_REQUIRED');
    await acknowledgeApprovalFinish(root, row.executionId);
    await assertNoUnresolvedApprovals(root, row.taskId);
    expect((await readApproval(root, row.executionId, row.operationId))?.acceptedFinish).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

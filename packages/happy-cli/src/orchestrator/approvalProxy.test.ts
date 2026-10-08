import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ApiClient } from '@/api/api';
import { readApproval, deliverApproval } from './approvalJournal';
import { startApprovalProxy } from './approvalProxy';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('releases only the matching approved operation and records invocation once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-approval-proxy-'));
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'test-branch', repo]);
  const journal = join(root, 'journal');
  const payload = { executionId: 'execution', runId: 'run', taskId: 'task', dispatchToken: 'dispatch',
    provider: 'codex' as const, executionType: 'initial' as const, prompt: '', timeoutMs: 30_000 };
  const api = { requestExecutionApproval: async ({ operationId, expiresAt }: { operationId: string; expiresAt: string }) =>
    ({ id: `decision-${operationId}`, version: 0, expiresAt }) } as unknown as ApiClient;
  const proxy = await startApprovalProxy({ api, payload, root: journal, machineId: 'machine',
    worktreePath: repo, identityReady: async (session) => { if (session !== 'session-1234') throw Error(); },
    active: () => true });
  const post = (body: unknown) => fetch(proxy.url, { method: 'POST',
    headers: { authorization: `Bearer ${proxy.capability}`, 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  try {
    const first = { kind: 'request', childSessionId: 'session-1234', operationId: hash('first'),
      actionType: 'shell', actionHash: hash('command-first'), summary: 'Shell command: first' };
    const second = { ...first, operationId: hash('second'), actionHash: hash('command-second') };
    const firstPending = post(first);
    const secondPending = post(second);
    let row = await readApproval(journal, 'execution', first.operationId);
    for (let attempt = 0; !row && attempt < 50; attempt++) { await delay(10); row = await readApproval(journal, 'execution', first.operationId); }
    expect(row?.state).toBe('requested');
    const binding = { taskId: 'task', machineId: 'machine', childSessionId: 'session-1234',
      worktreePath: repo, branchName: 'test-branch' };
    const delivery = { decisionId: row!.decisionId, executionId: 'execution', dispatchToken: 'dispatch',
      operationId: first.operationId, actionType: first.actionType, actionHash: first.actionHash,
      childSessionId: 'session-1234', worktreePathHash: hash(repo), branchName: 'test-branch',
      expiresAt: row!.expiresAt, version: 1, decision: 'approved' as const };
    expect(await deliverApproval(journal, { ...delivery, actionHash: hash('wrong') }, binding)).toBe(false);
    expect(await deliverApproval(journal, delivery, binding)).toBe(true);
    proxy.delivered(delivery);
    expect((await (await firstPending).json() as { approved: boolean }).approved).toBe(true);
    expect((await readApproval(journal, 'execution', first.operationId))?.state).toBe('invoking');
    expect((await (await post({ kind: 'result', operationId: first.operationId,
      actionHash: first.actionHash })).status)).toBe(200);
    expect((await readApproval(journal, 'execution', first.operationId))?.state).toBe('invoked');
    expect((await post({ kind: 'result', operationId: first.operationId,
      actionHash: first.actionHash })).status).toBe(409);
    let secondRow = await readApproval(journal, 'execution', second.operationId);
    for (let attempt = 0; !secondRow && attempt < 50; attempt++) { await delay(10); secondRow = await readApproval(journal, 'execution', second.operationId); }
    expect(secondRow?.state).toBe('requested');
    const rejected = { ...delivery, decisionId: secondRow!.decisionId, operationId: second.operationId,
      actionHash: second.actionHash, expiresAt: secondRow!.expiresAt, decision: 'rejected' as const };
    expect(await deliverApproval(journal, rejected, binding)).toBe(true);
    proxy.delivered(rejected);
    expect((await secondPending).status).toBe(409);
    expect((await readApproval(journal, 'execution', second.operationId))?.state).toBe('rejected');
  } finally { await proxy.close(); rmSync(root, { recursive: true, force: true }); }
});

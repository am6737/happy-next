import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApprovalProxy } from '../packages/happy-cli/src/orchestrator/approvalProxy';
import { readApproval, deliverApproval } from '../packages/happy-cli/src/orchestrator/approvalJournal';
import { acquireFileLock, type FileLock } from '../packages/happy-cli/src/orchestrator/fileLock';
import type { ApiClient } from '../packages/happy-cli/src/api/api';

// Production loopback proxy, journal, OS flock and real Git. Server/auth and
// active lease notification are fixtures; no provider/tool side effect occurs.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--branch-changed');
const branchChanged = args.includes('--branch-changed');
const root = await mkdtemp(join(tmpdir(), 'happy-approval-active-race-'));
const repo = join(root, 'repo'); const journal = join(root, 'journal');
execFileSync('git', ['init', '-q', '-b', 'fixture-branch', repo]);
const executionId = randomUUID(); const operationId = hash(randomUUID());
let active = true; let afterDecision = false; let signalFinal!: () => void;
const finalCheck = new Promise<void>(resolve => { signalFinal = resolve; });
let lock: FileLock | undefined;
const payload = { executionId, taskId: randomUUID(), runId: randomUUID(), dispatchToken: randomUUID(),
    provider: 'codex' as const, executionType: 'initial' as const, prompt: '', timeoutMs: 30000 };
const proxy = await startApprovalProxy({
    api: { requestExecutionApproval: async ({ expiresAt }: { expiresAt: string }) =>
        ({ id: randomUUID(), version: 0, expiresAt }) } as unknown as ApiClient,
    payload, root: journal, machineId: 'owned-fixture-machine', worktreePath: repo,
    identityReady: async () => {}, active: () => {
        if (afterDecision) signalFinal();
        return active;
    },
});
let request: Promise<Response> | undefined;
try {
    request = fetch(proxy.url, { method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { authorization: `Bearer ${proxy.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'request', childSessionId: 'fixture-session-1234', operationId,
            actionType: 'shell', actionHash: hash('owned-command'), summary: 'Owned fixture command' }) });
    let row = await readApproval(journal, executionId, operationId);
    for (let i = 0; !row && i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        row = await readApproval(journal, executionId, operationId);
    }
    assert.equal(row?.state, 'requested');
    // Let the initial waiter's recovery read finish while the row is requested.
    await new Promise(resolve => setTimeout(resolve, 50));
    const delivery = { decisionId: row!.decisionId, executionId, operationId,
        dispatchToken: payload.dispatchToken, actionType: row!.actionType, actionHash: row!.actionHash,
        childSessionId: row!.childSessionId, worktreePathHash: hash(repo), branchName: 'fixture-branch',
        expiresAt: row!.expiresAt, version: 1, decision: 'approved' as const };
    assert.equal(await deliverApproval(journal, delivery, { taskId: payload.taskId,
        machineId: 'owned-fixture-machine', childSessionId: row!.childSessionId,
        worktreePath: repo, branchName: 'fixture-branch' }), true);
    lock = await acquireFileLock(join(journal, '.queue.lock'), 2);
    afterDecision = true;
    proxy.delivered(delivery);
    await Promise.race([finalCheck, new Promise((_, reject) => setTimeout(() =>
        reject(new Error('Final active check not reached')), 3000).unref())]);
    // The final check was true, but invocation now waits on an actual OS lock.
    if (branchChanged) execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/replacement-branch'], { cwd: repo });
    else active = false;
    await lock.release(); lock = undefined;
    const response = await request;
    const result = await response.json() as { approved: boolean };
    const final = await readApproval(journal, executionId, operationId);
    console.log(JSON.stringify({ result: 'REAL_APPROVAL_ACTIVE_LOST_DURING_JOURNAL_LOCK',
        httpStatus: response.status, approved: result.approved, journalState: final?.state, active, branchChanged }));
    assert.equal(result.approved, false, 'Changed execution identity received a tool approval after the journal lock wait');
    console.log('REAL_APPROVAL_INACTIVE_AFTER_LOCK_CANNOT_RELEASE_ACTION_OK');
} finally {
    active = false; await lock?.release();
    await proxy.close(); await request?.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
}

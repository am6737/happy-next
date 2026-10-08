import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestApproval, deliverApproval, transitionApproval, readApproval }
    from '../packages/happy-cli/src/orchestrator/approvalJournal';

// Actual local journal/locks and owned filesystem effect. Authentication,
// approval payload and operation are fixtures, not a daemon/provider claim.
const root = await mkdtemp(join(tmpdir(), 'happy-approval-journal-real-'));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
try {
    const executionId = randomUUID(); const operationId = randomUUID();
    const taskId = randomUUID(); const machineId = randomUUID();
    const childSessionId = randomUUID(); const worktreePath = join(root, 'owned-worktree');
    const branchName = `happy-agent/${taskId}`; const dispatchToken = randomUUID();
    const expiresAt = new Date(Date.now() + 1200).toISOString();
    const actionHash = sha('owned-file-effect-fixture'); const decisionId = randomUUID();
    await requestApproval(join(root, 'journal'), { executionId, operationId, taskId, machineId,
        childSessionId, branchName, dispatchTokenHash: sha(dispatchToken),
        worktreePathHash: sha(worktreePath), decisionId, actionHash,
        actionType: 'file_change', requestVersion: 1, decisionVersion: null,
        state: 'requested', expiresAt });
    const binding = { taskId, machineId, childSessionId, worktreePath, branchName };
    const decision = { executionId, operationId, decisionId, dispatchToken,
        actionType: 'file_change', actionHash, childSessionId, branchName,
        worktreePathHash: sha(worktreePath), version: 2, decision: 'approved' as const };
    assert.equal(await deliverApproval(join(root, 'journal'), { ...decision, actionHash: sha('wrong') }, binding), false);
    assert.equal(await deliverApproval(join(root, 'journal'), decision, binding), true);
    assert.equal(await transitionApproval(join(root, 'journal'), executionId, operationId,
        actionHash, 'approved', 'invoking'), true);
    const effect = join(root, 'owned-effect.txt');
    await writeFile(effect, 'Owned effect was invoked once before permission expiry.\n', { flag: 'wx' });
    // The permission was consumed on time; completion/audit can arrive after
    // expiry. Persisting an outcome must never grant another invocation.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now() + 150)));
    const recorded = await transitionApproval(join(root, 'journal'), executionId, operationId,
        actionHash, 'invoking', 'invoked');
    const after = await readApproval(join(root, 'journal'), executionId, operationId);
    console.log(JSON.stringify({ result: 'REAL_FS_APPROVAL_COMPLETION_AFTER_EXPIRY', recorded,
        state: after?.state, effectExists: (await readFile(effect, 'utf8')).endsWith('\n') }));
    assert.equal(recorded, true, 'A consumed permission expiry prevented recording the actual operation outcome');
    assert.equal(after?.state, 'invoked');
    assert.equal(await transitionApproval(join(root, 'journal'), executionId, operationId,
        actionHash, 'approved', 'invoking'), false);
    console.log('REAL_FS_APPROVAL_OUTCOME_AFTER_EXPIRY_PERSISTED_WITHOUT_REINVOCATION_OK');
} finally { await rm(root, { recursive: true, force: true }); }

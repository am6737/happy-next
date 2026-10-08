import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeApprovalAction } from '../packages/happy-cli/src/orchestrator/approvalAction';

// Actual action normalizer and two owned directories; no model/tool execution.
// The production app-server backend forwards cwd in the permission callback.
const root = await mkdtemp(join(tmpdir(), 'happy-approval-action-real-'));
try {
    const original = join(root, 'task-worktree'); const changed = join(root, 'other-worktree');
    await Promise.all([mkdir(original), mkdir(changed)]);
    const sessionId = randomUUID(); const callId = randomUUID();
    const command = "printf 'owned approval fixture' > result.txt";
    const input = { command: [command], startedCommand: command, kind: 'command', cwd: original };
    const first = normalizeApprovalAction(sessionId, callId, 'CodexBash', input, original);
    assert.ok(first, 'An ordinary bounded shell action must be reviewable');
    const second = normalizeApprovalAction(sessionId, callId, 'CodexBash', { ...input, cwd: changed }, original);
    console.log(JSON.stringify({ result: 'REAL_APPROVAL_ACTION_CWD_IDENTITY',
        changedCwdAccepted: !!second, sameOperationId: second?.operationId === first.operationId,
        sameActionHash: second?.actionHash === first.actionHash }));
    assert.ok(!second || second.actionHash !== first.actionHash,
        'The same approved operation and action hash authorized the command in a different cwd');
    assert.equal(second, null, 'Trusted worktree must reject another directory');
    assert.equal(normalizeApprovalAction(sessionId, callId, 'CodexBash', {
        ...input, startedCwd: changed,
    }, original), null, 'Approval cwd differed from the started item');
    console.log('REAL_APPROVAL_ACTION_CHANGED_CWD_REJECTED_OR_HASH_BOUND_OK');

    const patch = (path: string) => ({ changes: [{ path, kind: { type: 'update' },
        diff: '@@ -1 +1 @@\n-old\n+new' }] });
    await writeFile(join(original, 'result.txt'), 'old\n');
    await writeFile(join(changed, 'result.txt'), 'outside owned fixture\n');
    assert.ok(normalizeApprovalAction(sessionId, randomUUID(), 'CodexPatch', patch('result.txt'), original),
        'An ordinary local patch must be reviewable');
    await symlink(changed, join(original, 'linked-outside'), 'dir');
    await symlink(join(changed, 'result.txt'), join(original, 'linked-file'));
    const outsideDirectory = normalizeApprovalAction(sessionId, randomUUID(), 'CodexPatch',
        patch('linked-outside/result.txt'), original);
    const outsideFile = normalizeApprovalAction(sessionId, randomUUID(), 'CodexPatch',
        patch('linked-file'), original);
    console.log(JSON.stringify({ result: 'REAL_APPROVAL_PATCH_TRUSTED_WORKTREE',
        outsideDirectoryAccepted: !!outsideDirectory, outsideFileAccepted: !!outsideFile }));
    assert.equal(outsideDirectory, null, 'Patch summary claimed task worktree for a directory symlink outside it');
    assert.equal(outsideFile, null, 'Patch summary claimed task worktree for a file symlink outside it');
    console.log('REAL_APPROVAL_PATCH_SYMLINK_OUTSIDE_WORKTREE_REJECTED_OK');
} finally { await rm(root, { recursive: true, force: true }); }

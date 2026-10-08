import assert from 'node:assert/strict';

// Check the controller's semantic proof as well as its outer report/hash.
// Diagnostic browser fixtures remain fixtures; they never prove AI delivery.
export function assertCompatibilityBusinessProof(log, id, expected) {
    assert.equal(typeof log, 'string');
    const lines = log.trim().split('\n');
    if (id === 'restore') {
        assert.deepEqual(lines, [
            'AI_TEAM_RESTORED_P3_DURABLE_STATE_OK decision=pending budget=reserved capabilityRevision=3',
            'AI_TEAM_ISOLATED_DATABASE_RESTORE_OK inbound=processing lease=preserved integration=pending execution=completed task=running',
            'AI_TEAM_RESTORED_P3_WORKER_AND_REVOCATION_OK pendingDecision=true reservedBudget=true oldCapability=denied',
            'AI_TEAM_RESTORED_PENDING_NO_RPC_OK ticks=4 attempts=0 noCompletion=true',
            'AI_TEAM_RESTORED_EXPIRED_LEASE_FENCED_OK inbound=reclaimed oldOwner=denied verificationAttempts=1 noCompletion=true mockRpc=rejected',
            'FIXTURE_CLEANUP databases=2 residual=0 archive=removed',
        ], 'RESTORE_BUSINESS_PROOF');
        return true;
    }
    assert.ok(id === 'app-five' || id === 'app-diagnostic', 'BUSINESS_PROOF_CASE');
    assert.equal(lines.pop(), 'ROOT_APP_INFRASTRUCTURE_OWNED_CLEANUP_COMPLETE', 'APP_INFRASTRUCTURE_CLEANUP');
    const records = lines.map(line => JSON.parse(line));
    const modes = id === 'app-five' ? ['pending', 'invoking', 'accepted', 'rejected', 'retry'] : ['diagnostic'];
    assert.deepEqual(records.map(record => record.mode).sort(), [...modes].sort(), 'APP_BUSINESS_MODES');
    const tags = new Set();
    for (const record of records) {
        assert.equal(record.fixedCliBundleSha256, expected.cliEntrySha256, 'APP_CLI_IDENTITY');
        assert.equal(record.artifactContextSha256, expected.contextSha256, 'APP_CONTEXT_IDENTITY');
        assert.equal(record.runtimeSource, 'bound_fresh');
        assert.ok(record.proof && record.cleanup);
        assert.equal(typeof record.proof.tag, 'string');
        assert.ok(record.proof.tag.length > 0 && !tags.has(record.proof.tag), 'APP_UNIQUE_PROOF');
        tags.add(record.proof.tag);
        assert.equal(record.cleanup.tag, record.proof.tag);
        assert.equal(record.cleanup.residualAccounts, 0, 'APP_ACCOUNT_CLEANUP');
        if (record.mode === 'diagnostic') {
            assert.equal(record.result, 'ROOT_APP_BROWSER_RESULT_FIXTURE_OK');
            assert.equal(record.script, 'ai-orchestrator-diagnostic-ui-fixture.mjs');
            assert.equal(record.proof.fixture, true);
            assert.equal(record.proof.rawDiagnosticHidden, true);
            assert.equal(record.proof.verifiedAnswerVisibleOnlyWhenTrusted, true);
            assert.equal(record.proof.deliveryNotInferred, true);
            assert.equal(record.proof.cases, 4);
            assert.equal(record.cleanup.publicKeyMatched, true);
        } else {
            assert.equal(record.result, 'ROOT_APP_REAL_BROWSER_PROVIDER_OK');
            if (record.mode === 'pending' || record.mode === 'invoking') {
                assert.equal(record.script, 'ai-approval-crash-ui-real-e2e.mjs');
                assert.equal(record.proof.provider, 'real_codex');
                assert.equal(record.cleanup.publicKeyMatched, true);
            } else if (record.mode === 'accepted' || record.mode === 'rejected') {
                assert.equal(record.script, 'ai-template-proposal-ui-real-e2e.mjs');
                assert.equal(record.proof.provider, 'real_codex_mcp');
            } else {
                assert.equal(record.script, 'ai-team-scoped-ui-real-e2e.mjs');
                for (const key of ['realProviderOutput', 'sameSession', 'sameWorktree', 'gitClean'])
                    assert.equal(record.proof[key], true, key);
                assert.equal(record.proof.retryHttpStatus, 200);
                assert.equal(record.proof.retryRequestCount, 1);
                assert.equal(record.proof.workItemCount, 1);
                assert.equal(record.cleanup.publicKeysMatched, true);
            }
        }
    }
    return true;
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCompatibilityBusinessProof } from './aiTeamCompatibilityBusinessProofs.mjs';

const expected = { cliEntrySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64) };
const cleanupMarker = 'ROOT_APP_INFRASTRUCTURE_OWNED_CLEANUP_COMPLETE';
const records = ['pending', 'invoking', 'accepted', 'rejected', 'retry'].map(mode => {
    const crash = mode === 'pending' || mode === 'invoking';
    const template = mode === 'accepted' || mode === 'rejected';
    return {
        result: 'ROOT_APP_REAL_BROWSER_PROVIDER_OK', mode,
        script: crash ? 'ai-approval-crash-ui-real-e2e.mjs'
            : template ? 'ai-template-proposal-ui-real-e2e.mjs' : 'ai-team-scoped-ui-real-e2e.mjs',
        proof: { tag: `fixture-${mode}`, ...(crash ? { provider: 'real_codex' }
            : template ? { provider: 'real_codex_mcp' }
                : { realProviderOutput: true, sameSession: true, sameWorktree: true,
                    gitClean: true, retryHttpStatus: 200, retryRequestCount: 1, workItemCount: 1 }) },
        cleanup: { tag: `fixture-${mode}`, residualAccounts: 0,
            ...(crash ? { publicKeyMatched: true } : template ? {} : { publicKeysMatched: true }) },
        fixedCliBundleSha256: expected.cliEntrySha256,
        artifactContextSha256: expected.contextSha256, runtimeSource: 'bound_fresh',
    };
});
const log = (items, cleanup = true) => [...items.map(item => JSON.stringify(item)),
    ...(cleanup ? [cleanupMarker] : [])].join('\n');

test('App requires complete real business modes, identity, and owned cleanup', () => {
    assert.equal(assertCompatibilityBusinessProof(log(records), 'app-five', expected), true);
    assert.throws(() => assertCompatibilityBusinessProof('NO_BUSINESS_PROOF_NO_CLEANUP', 'app-five', expected));
    assert.throws(() => assertCompatibilityBusinessProof(log(records, false), 'app-five', expected));
    assert.throws(() => assertCompatibilityBusinessProof(log(records.slice(1)), 'app-five', expected));
    assert.throws(() => assertCompatibilityBusinessProof(log([...records, records[0]]), 'app-five', expected));
    for (const mutate of [
        items => { items[0].artifactContextSha256 = 'c'.repeat(64); },
        items => { items[0].fixedCliBundleSha256 = 'd'.repeat(64); },
        items => { items[0].cleanup.residualAccounts = 1; },
        items => { items[0].cleanup.publicKeyMatched = false; },
        items => { items[4].proof.sameWorktree = false; },
        items => { items[4].proof.retryRequestCount = 2; },
        items => { items[4].proof.realProviderOutput = false; },
        items => { items[2].proof.provider = 'browser_fixture'; },
    ]) {
        const changed = structuredClone(records); mutate(changed);
        assert.throws(() => assertCompatibilityBusinessProof(log(changed), 'app-five', expected));
    }
});

test('diagnostic fixtures cannot replace real business delivery proofs', () => {
    const diagnostic = { ...records[0], mode: 'diagnostic',
        result: 'ROOT_APP_BROWSER_RESULT_FIXTURE_OK', script: 'ai-orchestrator-diagnostic-ui-fixture.mjs',
        proof: { tag: 'fixture-diagnostic', fixture: true, rawDiagnosticHidden: true,
            verifiedAnswerVisibleOnlyWhenTrusted: true, deliveryNotInferred: true, cases: 4 },
        cleanup: { tag: 'fixture-diagnostic', publicKeyMatched: true, residualAccounts: 0 } };
    assert.equal(assertCompatibilityBusinessProof(log([diagnostic]), 'app-diagnostic', expected), true);
    assert.throws(() => assertCompatibilityBusinessProof(log([diagnostic]), 'app-five', expected));
    diagnostic.proof.deliveryNotInferred = false;
    assert.throws(() => assertCompatibilityBusinessProof(log([diagnostic]), 'app-diagnostic', expected));
});

test('restore requires durable state, worker fencing, and database/archive cleanup', () => {
    const lines = [
        'AI_TEAM_RESTORED_P3_DURABLE_STATE_OK decision=pending budget=reserved capabilityRevision=3',
        'AI_TEAM_ISOLATED_DATABASE_RESTORE_OK inbound=processing lease=preserved integration=pending execution=completed task=running',
        'AI_TEAM_RESTORED_P3_WORKER_AND_REVOCATION_OK pendingDecision=true reservedBudget=true oldCapability=denied',
        'AI_TEAM_RESTORED_PENDING_NO_RPC_OK ticks=4 attempts=0 noCompletion=true',
        'AI_TEAM_RESTORED_EXPIRED_LEASE_FENCED_OK inbound=reclaimed oldOwner=denied verificationAttempts=1 noCompletion=true mockRpc=rejected',
        'FIXTURE_CLEANUP databases=2 residual=0 archive=removed',
    ];
    assert.equal(assertCompatibilityBusinessProof(lines.join('\n'), 'restore', expected), true);
    for (let i = 0; i < lines.length; i++)
        assert.throws(() => assertCompatibilityBusinessProof(lines.filter((_, j) => j !== i).join('\n'), 'restore', expected));
    assert.throws(() => assertCompatibilityBusinessProof(lines.join('\n').replace('residual=0', 'residual=1'), 'restore', expected));
});

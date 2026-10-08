import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { verifyPublishedNpmTree, verifyOldServerTrackedTree } from './aiTeamOldComponentIdentity.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oldServerRevision = '08030b85829f85f4d6db32abf28c96f8e5a52329';
const oldCliIntegrity = 'sha512-oZnj0gqM0yy/hHMNZtf4LUo9aDHuIOeHf7bBmvvdqQgZ3MWZmjbsIVPF0NQlSwGTstxNCZGXdt3fTd9GwITjXg==';
const oldCliGitHead = '7f15e2bb0ed62a137d272fc3b11aeaa9f04dec4e';
const caseIds = ['compat-old-upgrade', 'compat-old-generic', 'compat-finish',
    'compat-owner', 'compat-owner-inflight', 'compat-owner-cancel', 'compat-redis',
    'old-agent-safe', 'old-agent-generic', 'app-five', 'app-diagnostic', 'restore'];
const liveIds = new Set(caseIds.filter((id) => id.startsWith('compat-')));
const checks = ['wire-build', 'old-cli-new-server', 'new-cli-old-server',
    'app-server', 'isolated-db-restore', 'migration-plan-review'];
const serverCases = [
    'verifyAiFinishTenantPublicApiRealDb', 'verifyAiDispatchCapabilityRealDb',
    'verifyAiRuntimeResultProjectionRealDb', 'verifyAiMemberControlRevokeRealDb:--commit-read',
    'verifyAiDecisionRevokeDuringReadRealDb', 'verifyAiDecisionRevokeRaceRealDb',
    'verifyAiBudgetRealDb', 'verifyAiAutopilotConcurrencyRealDb',
    'verifyAiAutopilotLostLeaseRealDb:during-submit',
    'verifyAiAutopilotLostLeaseRealDb:during-expiry', 'verifyAiAutopilotCronRealDb',
    'verifyAiAutopilotWebhookRealDb', 'verifyAiSkillsRealDb',
    'verifyAiAgentTemplateRealDb', 'verifyAiAgentArchiveRealDb',
    'verifyAiExecutionTemplateProposalRealDb', 'verifyAiWorkspaceGrantRaceRealDb',
    'verifyAiWorkspaceGrantSnapshotRealDb',
];

function regularBytes(path, limit = 2_000_000) {
    assert.equal(typeof path, 'string');
    assert.ok(path.startsWith('/tmp/') && resolve(path) === path, 'EVIDENCE_PATH');
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'EVIDENCE_FILE');
    assert.equal(realpathSync(path), path, 'EVIDENCE_SYMLINK_PARENT');
    return readFileSync(path);
}
function jsonRef(path) {
    const bytes = regularBytes(path);
    return { path, sha256: sha256(bytes), data: JSON.parse(bytes.toString('utf8')) };
}
function bytesRef(path) { return { path, sha256: sha256(regularBytes(path)) }; }
function readRef(ref) {
    assert.deepEqual(Object.keys(ref).sort(), ['path', 'sha256']);
    assert.match(ref.sha256, /^[0-9a-f]{64}$/);
    const bytes = regularBytes(ref.path);
    assert.equal(sha256(bytes), ref.sha256, 'EVIDENCE_BYTES_CHANGED');
    return bytes;
}
function report(ref) { return JSON.parse(readRef(ref).toString('utf8')); }
function wrapper(ref, logRef, id, expected) {
    const data = report(ref);
    assert.equal(data.format, 'happy-ai-team-independent-final-case-v1');
    assert.equal(data.name, id);
    assert.equal(data.contextSha256, expected.contextSha256);
    assert.equal(data.sourceSha256, expected.sourceSha256);
    assert.equal(data.sourceRoot, expected.sourceRoot);
    assert.equal(data.runtimeRoot, expected.artifactRoot);
    assert.equal(data.exitCode, 0);
    assert.equal(data.signal, null);
    assert.equal(data.artifactStable, true);
    assert.equal(data.result, 'PASS');
    assert.equal(data.productionReady, false);
    assert.ok(Array.isArray(data.command) && data.command.length >= 2);
    assert.equal(logRef.path, ref.path.replace(/\.json$/, '.log'));
    assert.equal(data.logSha256, logRef.sha256);
    readRef(logRef);
    for (const key of ['wireDist', 'cliDist', 'appWebDist'])
        assert.deepEqual(data.artifacts[key], expected.artifacts[key]);
    return data;
}
function proofLines(ref, count) {
    const lines = readRef(ref).toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, count, 'EVIDENCE_PROOF_LINE_COUNT');
    return lines;
}
export function assertAppBusinessProof(ref, id, expected) {
    const diagnostic = id === 'app-diagnostic';
    const cases = diagnostic
        ? [['ai-orchestrator-diagnostic-ui-fixture.mjs', 'diagnostic']]
        : [['ai-approval-crash-ui-real-e2e.mjs', 'pending'],
            ['ai-approval-crash-ui-real-e2e.mjs', 'invoking'],
            ['ai-template-proposal-ui-real-e2e.mjs', 'accepted'],
            ['ai-template-proposal-ui-real-e2e.mjs', 'rejected'],
            ['ai-team-scoped-ui-real-e2e.mjs', 'retry']];
    const lines = proofLines(ref, cases.length + 1);
    assert.equal(lines.at(-1), 'ROOT_APP_INFRASTRUCTURE_OWNED_CLEANUP_COMPLETE');
    for (const [index, [script, mode]] of cases.entries()) {
        const record = JSON.parse(lines[index]);
        assert.equal(record.result, diagnostic ? 'ROOT_APP_BROWSER_RESULT_FIXTURE_OK'
            : 'ROOT_APP_REAL_BROWSER_PROVIDER_OK');
        assert.equal(record.script, script);
        assert.equal(record.mode, mode);
        assert.equal(record.fixedCliBundleSha256, expected.cliEntrySha256);
        assert.equal(record.artifactContextSha256, expected.contextSha256);
        assert.equal(record.runtimeSource, 'bound_fresh');
        assert.match(record.proof.tag, /^[A-Za-z0-9-]+$/);
        assert.equal(record.cleanup.tag, record.proof.tag);
        assert.equal(record.cleanup.residualAccounts, 0);
        if (diagnostic) {
            assert.equal(record.proof.fixture, true);
            assert.equal(record.proof.rawDiagnosticHidden, true);
            assert.equal(record.proof.verifiedAnswerVisibleOnlyWhenTrusted, true);
            assert.equal(record.proof.deliveryNotInferred, true);
            assert.equal(record.proof.cases, 4);
            assert.equal(record.cleanup.publicKeyMatched, true);
        } else if (mode === 'retry') {
            for (const key of ['realProviderOutput', 'sameSession', 'sameWorktree', 'gitClean'])
                assert.equal(record.proof[key], true);
            assert.equal(record.proof.retryHttpStatus, 200);
            assert.equal(record.proof.retryRequestCount, 1);
            assert.equal(record.proof.workItemCount, 1);
            assert.equal(record.cleanup.publicKeysMatched, true);
        } else {
            assert.equal(record.proof.provider, script.startsWith('ai-approval-')
                ? 'real_codex' : 'real_codex_mcp');
            if (script.startsWith('ai-approval-'))
                assert.equal(record.cleanup.publicKeyMatched, true);
        }
    }
}
export function assertRestoreBusinessProof(ref) {
    assert.deepEqual(proofLines(ref, 6), [
        'AI_TEAM_RESTORED_P3_DURABLE_STATE_OK decision=pending budget=reserved capabilityRevision=3',
        'AI_TEAM_ISOLATED_DATABASE_RESTORE_OK inbound=processing lease=preserved integration=pending execution=completed task=running',
        'AI_TEAM_RESTORED_P3_WORKER_AND_REVOCATION_OK pendingDecision=true reservedBudget=true oldCapability=denied',
        'AI_TEAM_RESTORED_PENDING_NO_RPC_OK ticks=4 attempts=0 noCompletion=true',
        'AI_TEAM_RESTORED_EXPIRED_LEASE_FENCED_OK inbound=reclaimed oldOwner=denied verificationAttempts=1 noCompletion=true mockRpc=rejected',
        'FIXTURE_CLEANUP databases=2 residual=0 archive=removed',
    ], 'EVIDENCE_RESTORE_PROOF');
}
function managed(data, id, expected) {
    assert.equal(data.format, id === 'compat-old-upgrade'
        ? 'happy-ai-team-old-client-upgrade-probe-v1' : 'happy-ai-team-managed-diagnostic-v1');
    assert.equal(data.result, 'passed');
    assert.equal(data.artifactContextSha256, expected.contextSha256);
    assert.equal(data.sourceRoot, expected.sourceRoot);
    assert.equal(data.runtimeRoot, expected.artifactRoot);
    assert.equal(data.candidateBeforeSha256, expected.candidateSha256);
    assert.equal(data.candidateAfterSha256, expected.candidateSha256);
    assert.equal(data.candidateStable, true);
    if (id === 'compat-old-upgrade') {
        assert.equal(data.serverSourceStable, true);
        assert.equal(data.machine.registered, true);
        assert.equal(data.machine.featureRoutePresent, false);
        assert.equal(data.afterFourTicks.workerExitCode, 0);
        assert.equal(data.afterFourTicks.markerPresent, true);
        assert.ok(data.afterFourTicks.rows.every((row) =>
            row.executions === 1 && row.taskStatus === 'failed'));
        assert.equal(data.machine.oldDaemonProcessStarted, true);
        assert.equal(data.machine.dispatchRoutePresent, true);
        assert.deepEqual(data.observations.map((item) => item.kind).sort(), ['coordinator', 'work_item']);
        for (const item of data.observations) {
            assert.equal(item.taskErrorCode, 'UPGRADE_REQUIRED');
            assert.equal(item.executionErrorCode, 'UPGRADE_REQUIRED');
            assert.equal(item.executionCount, 1);
            assert.equal(item.providerPidPresent, false);
            assert.equal(item.sideEffectCount, 0);
        }
        assert.equal(data.git.baseEqualsAfter, true);
        assert.equal(data.git.dirty, false);
        assert.equal(data.cleanup.databaseResidual, 0);
        assert.equal(data.cleanup.homeRemoved, true);
        assert.equal(data.cleanup.redisContainerRemoved, true);
    } else {
        assert.equal(data.actualDaemon, true);
        assert.equal(data.cliExitCode, 0);
        assert.equal(data.onlyBStartsScheduler, true);
        assert.equal(data.fixtureCleanup.residual, 0);
        assert.equal(data.fixtureCleanup.homeRemoved, true);
        assert.ok(data.fixtureCleanup.databases === 1 && data.fixtureCleanup.machines === 1);
        assert.equal(data.currentCliBundle.sha256, expected.cliEntrySha256);
        assert.equal(data.currentCliBundle.treeSha256, expected.artifacts.cliDist.sha256);
        assert.equal(data.currentCliBundle.build.sourceInputsSha256, expected.sourceSha256);
        if (id === 'compat-old-generic') {
            assert.equal(data.scope, 'published-npm-old-cli-daemon-current-server-generic-orchestrator');
            for (const key of ['processCompleted', 'durableFinish', 'trustedAnswerVerified', 'deliveryVerified'])
                assert.equal(data.genericDelivery[key], true);
            assert.equal(data.taskExecutionAttempts, 1);
        } else if (id === 'compat-finish') {
            assert.equal(data.daemonFinishRestartRequested, true);
            assert.equal(data.durableQueueObserved, true);
            assert.equal(data.daemonKilledAfterQueue, true);
            assert.equal(data.executionStatus, 'completed');
            assert.equal(data.taskExecutionAttempts, 1);
        } else if (id === 'compat-owner') {
            assert.equal(data.ownerSwitch.instanceChanged, true);
            assert.equal(data.ownerSwitch.epochAdvanced, true);
            assert.equal(data.executionStatus, 'completed');
            assert.equal(data.taskExecutionAttempts, 1);
            assert.equal(data.persistedCommitMatches, true);
            assert.equal(data.persistedFinalResponse, true);
        } else if (id === 'compat-owner-inflight' || id === 'compat-owner-cancel') {
            assert.equal(data.ownerSwitch.instanceChanged, true);
            assert.equal(data.ownerSwitch.epochAdvanced, true);
            assert.equal(data.ownerCancel.helperTerminationMarker, true);
            assert.equal(data.ownerCancel.helperExactFileAbsentAndOriginalPid, true);
            assert.equal(data.ownerCancel.runStatus, 'cancelled');
            assert.equal(data.ownerCancel.taskStatus, 'cancelled');
            assert.equal(data.ownerCancel.executionCount, 1);
            assert.equal(data.ownerCancel.newCommitBeyondBase, false);
            if (id === 'compat-owner-inflight') {
                assert.equal(data.ownerSwitch.actualDaemonAckHeld, true);
                assert.equal(data.ownerSwitch.bridgeRequestMatched, true);
                assert.equal(data.ownerSwitch.oldAckRejected, true);
            }
        } else if (id === 'compat-redis') {
            assert.equal(data.redisPause.firstStatus, 503);
            assert.equal(data.redisPause.retryAfterPresent, true);
            assert.equal(data.redisPause.firstErrorCode, 'AI_RPC_BRIDGE_UNAVAILABLE');
            assert.equal(data.redisPause.runsAfterFirstFailure, 0);
            assert.equal(data.redisPause.projectsAfterFirstFailure, 0);
            assert.equal(data.redisPause.replayedSameBytes, true);
            assert.ok([200, 201].includes(data.redisPause.retryStatus));
        }
    }
}
export function assertOldCliIdentityProof(data, expected) {
    const old = data.oldPublishedCli ?? data.oldBuild;
    assert.ok(old && old.packageRoot.startsWith('/tmp/ai-team-published-old-')
        && old.packageRoot.endsWith('/package'));
    assert.equal(realpathSync(old.packageRoot), old.packageRoot);
    assert.equal(old.registryIntegrity, oldCliIntegrity);
    assert.equal(old.registryGitHeadObserved, oldCliGitHead);
    assert.notEqual(oldCliGitHead, oldServerRevision);
    const archive = regularBytes(resolve(old.packageRoot, '..', 'package.tgz'), 200_000_000);
    assert.equal(`sha512-${createHash('sha512').update(archive).digest('base64')}`, oldCliIntegrity);
    assert.equal(sha256(archive), old.archiveSha256);
    assert.equal(sha256(regularBytes(join(old.packageRoot, 'package-lock.json'), 20_000_000)), old.packageLockSha256);
    assert.equal(sha256(regularBytes(join(old.packageRoot, 'dist/index.mjs'), 20_000_000)), old.distIndexSha256);
    const pkg = JSON.parse(regularBytes(join(old.packageRoot, 'package.json')).toString('utf8'));
    assert.equal(pkg.name, 'happy-next-cli');
    assert.equal(pkg.version, '0.10.0');
    assert.equal(expected.oldCliIntegrity, oldCliIntegrity);
    assert.equal(data.oldPublishedCliStable, true);
    const dependencyRoot = expected.artifactRoot
        ?? (expected.allowUnboundUnitFixture === true ? expected.sourceRoot : null);
    assert.ok(dependencyRoot, 'OLD_NPM_BOUND_DEPENDENCY_ROOT_REQUIRED');
    const actual = verifyPublishedNpmTree(old.packageRoot, dependencyRoot);
    assert.deepEqual(data.oldPublishedCliAfter, actual);
    for (const key of ['packageRoot', 'archiveSha256', 'registryIntegrity', 'members',
        'packedTreeSha256', 'generatedLockSha256', 'dependencyRoot', 'qualification'])
        assert.equal(old[key], actual[key], `OLD_NPM_${key}`);
}
export function assertOldServerIdentityProof(log, id, expected) {
    assert.equal(log.revision, oldServerRevision);
    assert.equal(log.formalEntrySha256, expected.cliEntrySha256);
    assert.equal(log.healthStatus, 200);
    assert.equal(log.legacy404Shape, 'old-custom-exact');
    assert.equal(log.machineReady, true);
    assert.equal(log.repoClean, true);
    assert.equal(log.ownedDatabaseDropped, true);
    assert.equal(log.ownedTempRemoved, true);
    assert.equal(log.oldRootIdentityStable, true);
    assert.deepEqual(log.oldRootIdentityBefore, log.oldRootIdentityAfter);
    assert.deepEqual(log.oldRootIdentityAfter,
        verifyOldServerTrackedTree(log.oldRootIdentityAfter.oldRoot,
            oldServerRevision, expected.sourceRoot));
    if (id === 'old-agent-safe') {
        assert.equal(log.result, 'AGENT_REJECTED');
        assert.equal(log.executionStatus, 'failed');
        assert.equal(log.errorCode, 'LEGACY_AGENT_IDENTITY_UNVERIFIED');
        assert.equal(log.providerStarted, false);
        assert.equal(log.dispatchPayloadHasAgentIdentity, false);
        assert.equal(log.localLegacyBinding, false);
    } else {
        assert.equal(log.result, 'GENERIC_COMPLETED');
        assert.equal(log.executionStatus, 'completed');
        assert.equal(log.providerStarted, true);
        assert.equal(log.localLegacyBinding, true);
        assert.equal(log.finalContainsMarker, true);
    }
    assert.equal(expected.oldServerRevision, oldServerRevision);
    assert.equal(execFileSync('git', ['rev-parse', '--verify', `${oldServerRevision}^{commit}`],
        { cwd: expected.sourceRoot, encoding: 'utf8' }).trim(), oldServerRevision);
}
function serverMatrix(data, expected) {
    assert.equal(data.format, 'ai-server-deadline-realdb-v1');
    assert.equal(data.sourceSha256, expected.sourceSha256);
    assert.equal(data.contextSha256, expected.contextSha256);
    assert.equal(data.sourceRoot, expected.sourceRoot);
    assert.equal(data.freshRoot, expected.artifactRoot);
    assert.equal(data.beforeBinding, true);
    assert.equal(data.afterBinding, true);
    assert.ok(Array.isArray(data.cases) && data.cases.length === serverCases.length);
    const names = new Set();
    for (const item of data.cases) {
        const key = [item.name, ...(item.args ?? [])].join(':');
        assert.ok(!names.has(key)); names.add(key);
        assert.equal(item.exitCode, 0);
        assert.equal(item.signal, null);
        assert.equal(item.timedOut, false);
        assert.equal(dirname(item.logPath), data.output);
        assert.match(basename(item.logPath),
            /^[0-9]{2}-verifyAi[A-Za-z0-9]+(?:-+[a-z0-9-]+)?\.log$/);
        assert.equal(sha256(regularBytes(item.logPath, 20_000_000)), item.logSha256);
    }
    assert.deepEqual([...names].sort(), [...serverCases].sort());
}
function imageMigration(data, expected) {
    assert.equal(data.sourceSha256, expected.sourceSha256);
    assert.equal(data.contextSha256, expected.contextSha256);
    assert.equal(data.serverSourceMatchesFrozen, true);
    assert.ok(Number.isInteger(data.serverSourceFiles) && data.serverSourceFiles > 0);
    assert.equal(data.migrationExitCode, 0);
    assert.equal(data.healthVerified, true);
    assert.equal(data.metricsStatus, 200);
    assert.equal(data.artifactStable, true);
    assert.equal(data.publishedImageVerified, false);
    assert.deepEqual(data.residualContainers, []);
    assert.equal(data.networkRemoved, true);
    assert.match(data.image, /^sha256:[0-9a-f]{64}$/);
}
export const requiredCompatibilityChecksV2 = checks;
export const requiredCompatibilityCasesV2 = caseIds;
export function assertCompatibilityEvidenceV2(evidence, expected) {
        assert.equal(evidence.format, 'happy-ai-team-compatibility-evidence-v2');
        assert.equal(evidence.candidateSha256, expected.candidateSha256);
        assert.equal(evidence.artifactContextSha256, expected.contextSha256);
        assert.equal(evidence.sourceSha256, expected.sourceSha256);
        assert.equal(evidence.sourceRoot, expected.sourceRoot);
        assert.equal(evidence.artifactRoot, expected.artifactRoot);
        assert.equal(evidence.producerSha256, expected.producerSha256);
        assert.deepEqual(evidence.requiredChecks, checks);
        assert.deepEqual(Object.keys(evidence.cases).sort(), [...caseIds].sort());
        const used = new Set();
        for (const id of caseIds) {
            const entry = evidence.cases[id];
            assert.deepEqual(Object.keys(entry).sort(), liveIds.has(id)
                ? ['live', 'log', 'wrapper'] : ['log', 'wrapper']);
            for (const ref of Object.values(entry)) {
                assert.ok(!used.has(ref.path), 'EVIDENCE_DUPLICATE_PATH'); used.add(ref.path);
            }
            const wrapped = wrapper(entry.wrapper, entry.log, id, expected);
            if (id.startsWith('compat-')) {
                assert.deepEqual(wrapped.command.slice(0, 4), [
                    join(expected.artifactRoot, 'node_modules/.bin/tsx'), '--tsconfig',
                    join(expected.artifactRoot, 'packages/happy-server/tsconfig.json'),
                    join(expected.sourceRoot, 'scripts/verifyAiTeamCompatibilityReal.mts')]);
                assert.equal(wrapped.command[5], entry.live.path);
                assert.equal(wrapped.command[4], id === 'compat-old-upgrade'
                    ? '--old-client-ai-upgrade-probe' : '--managed-daemon-diagnostic');
                const flag = { 'compat-old-generic': '--published-generic',
                    'compat-finish': '--daemon-finish-restart',
                    'compat-owner': '--managed-owner-switch',
                    'compat-owner-inflight': '--managed-owner-inflight-cancel',
                    'compat-owner-cancel': '--managed-owner-cancel',
                    'compat-redis': '--managed-redis-pause' }[id];
                if (flag) assert.ok(wrapped.command.includes(flag));
                const live = report(entry.live);
                managed(live, id, expected);
                if (id === 'compat-old-upgrade' || id === 'compat-old-generic')
                    assertOldCliIdentityProof(live, expected);
            } else if (id.startsWith('old-agent-')) {
                assert.deepEqual(wrapped.command, [process.execPath,
                    join(expected.sourceRoot, 'packages/happy-cli/scripts/ai-team-old-agent-identity-probe.mjs'),
                    id === 'old-agent-safe' ? '--expect-safe' : '--generic']);
                const lines = readRef(entry.log).toString('utf8').trim().split('\n');
                assert.equal(lines.length, 1);
                assertOldServerIdentityProof(JSON.parse(lines[0]), id, expected);
            } else if (id === 'app-five' || id === 'app-diagnostic') {
                assert.deepEqual(wrapped.command.slice(0, 4), [
                    join(expected.artifactRoot, 'node_modules/.bin/tsx'), '--tsconfig',
                    join(expected.artifactRoot, 'packages/happy-server/tsconfig.json'),
                    join(expected.sourceRoot, 'scripts/verifyAiAppProductionReal.mts')]);
                assert.deepEqual(wrapped.command.slice(4), [id === 'app-diagnostic'
                    ? '--diagnostic-fixture-only' : '--include-browser-retry']);
                assertAppBusinessProof(entry.log, id, expected);
            } else if (id === 'restore') {
                assert.deepEqual(wrapped.command, [
                    join(expected.artifactRoot, 'node_modules/.bin/tsx'), '--tsconfig',
                    join(expected.artifactRoot, 'packages/happy-server/tsconfig.json'),
                    join(expected.artifactRoot, 'scripts/verifyAiTeamDatabaseRestore.mts')]);
                assertRestoreBusinessProof(entry.log);
            }
        }
        assert.deepEqual(Object.keys(evidence.build).sort(), ['fresh', 'snapshot']);
        for (const ref of [evidence.build.fresh, evidence.build.snapshot,
            evidence.server, evidence.image]) {
            assert.ok(!used.has(ref.path), 'EVIDENCE_DUPLICATE_PATH'); used.add(ref.path);
        }
        const build = report(evidence.build.fresh);
        const snapshot = report(evidence.build.snapshot);
        assert.equal(build.format, 'happy-ai-team-fresh-consumer-build-v1');
        assert.equal(snapshot.format, 'happy-ai-team-source-snapshot-v1');
        assert.equal(build.root, expected.artifactRoot);
        assert.equal(build.sourceSha256, expected.sourceSha256);
        assert.equal(snapshot.sourceSha256, expected.sourceSha256);
        assert.equal(snapshot.sourceRoot, expected.sourceRoot);
        assert.equal(build.consumerChecksPassed, true);
        assert.equal(build.steps.length, 9);
        assert.ok(build.steps.some((step) => step.step === 'wire-build' && step.exitCode === 0));
        assert.deepEqual(build.artifacts.cliDist, { files: expected.artifacts.cliDist.files,
            sha256: expected.artifacts.cliDist.sha256 });
        assert.deepEqual(build.artifacts.wireDist, { files: expected.artifacts.wireDist.files,
            sha256: expected.artifacts.wireDist.sha256 });
        assert.equal(evidence.build.fresh.path, expected.freshBuildReport);
        assert.equal(evidence.build.snapshot.path, expected.sourceSnapshot);
        serverMatrix(report(evidence.server), expected);
        imageMigration(report(evidence.image), expected);
        assert.equal(evidence.migration.inventorySha256, expected.migrationSha256);
        assert.equal(evidence.migration.count, expected.migrationCount);
        assert.equal(expected.migrationInventoryComplete, true);
        assert.equal(evidence.migration.reviewBoundary,
            'read-only inventory and isolated migration only; no live rollout or rollback approval');
        return true;
}
export function verifyCompatibilityEvidenceV2(evidence, expected) {
    try { return assertCompatibilityEvidenceV2(evidence, expected); }
    catch { return false; }
}
export function createCompatibilityEvidenceV2(paths, expected) {
    const cases = Object.fromEntries(caseIds.map((id) => {
        const wrapperPath = `${paths.casePrefix}-${id}-${paths.caseSuffix}.json`;
        return [id, { wrapper: jsonRef(wrapperPath),
            log: bytesRef(wrapperPath.replace(/\.json$/, '.log')),
            ...(liveIds.has(id) ? { live: jsonRef(`${paths.casePrefix}-${id}-live-${paths.caseSuffix}.json`) } : {}) }];
    }));
    const onlyRefs = (entries) => Object.fromEntries(Object.entries(entries).map(([key, value]) =>
        [key, { path: value.path, sha256: value.sha256 }]));
    const evidence = { format: 'happy-ai-team-compatibility-evidence-v2',
        candidateSha256: expected.candidateSha256, artifactContextSha256: expected.contextSha256,
        sourceSha256: expected.sourceSha256, sourceRoot: expected.sourceRoot,
        artifactRoot: expected.artifactRoot, producerSha256: expected.producerSha256,
        requiredChecks: checks,
        cases: Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, onlyRefs(value)])),
        build: { fresh: onlyRefs({ fresh: jsonRef(expected.freshBuildReport) }).fresh,
            snapshot: onlyRefs({ snapshot: jsonRef(expected.sourceSnapshot) }).snapshot },
        server: onlyRefs({ server: jsonRef(paths.serverReport) }).server,
        image: onlyRefs({ image: jsonRef(paths.imageReport) }).image,
        migration: { inventorySha256: expected.migrationSha256, count: expected.migrationCount,
            reviewBoundary: 'read-only inventory and isolated migration only; no live rollout or rollback approval' } };
    assertCompatibilityEvidenceV2(evidence, expected);
    return evidence;
}
export function compatibilityEvidenceExpected(audit, binding, context, producerSha256) {
    return { candidateSha256: audit.candidateSha256,
        contextSha256: binding.contextSha256, sourceSha256: binding.sourceSha256,
        sourceRoot: context.sourceRoot, artifactRoot: binding.artifactRoot,
        producerSha256, artifacts: binding.artifacts,
        cliEntrySha256: sha256(regularBytes(join(binding.artifactRoot,
            'packages/happy-cli/dist/index.mjs'), 20_000_000)),
        oldCliIntegrity, oldServerRevision,
        migrationSha256: audit.migrationManifestSha256, migrationCount: audit.migrationCount,
        migrationInventoryComplete: audit.migrationInventoryComplete,
        freshBuildReport: context.freshBuildReport, sourceSnapshot: context.sourceSnapshot };
}

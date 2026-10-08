import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertAppBusinessProof, assertOldCliIdentityProof,
    assertOldServerIdentityProof, assertRestoreBusinessProof,
    createCompatibilityEvidenceV2, verifyCompatibilityEvidenceV2,
} from './aiTeamProductionCompatibilityEvidence.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const prefix = process.env.AI_TEAM_COMPAT_TEST_PREFIX ?? '/tmp/ai-team-deadline';
const suffix = process.env.AI_TEAM_COMPAT_TEST_SUFFIX ?? 'root-20261008';
const runtime = process.env.AI_TEAM_COMPAT_TEST_RUNTIME
    ?? '/tmp/ai-team-frozen-deps-rootdeadline08b6f42a';
const serverReport = process.env.AI_TEAM_COMPAT_TEST_SERVER
    ?? '/tmp/ai-server-deadline-3e64d9c1bd8b/report.json';
const imageReport = process.env.AI_TEAM_COMPAT_TEST_IMAGE
    ?? '/tmp/ai-image-root-9f95aee1fd-report.json';
const archived = '/tmp/ai-team-deadline';
const archivedSuffix = 'root-20261008';
const archivedRuntime = '/tmp/ai-team-frozen-deps-rootdeadline08b6f42a';
const oldIntegrity = 'sha512-oZnj0gqM0yy/hHMNZtf4LUo9aDHuIOeHf7bBmvvdqQgZ3MWZmjbsIVPF0NQlSwGTstxNCZGXdt3fTd9GwITjXg==';
const oldRevision = '08030b85829f85f4d6db32abf28c96f8e5a52329';
const ref = (path) => ({ path, sha256: hash(readFileSync(path)) });

test('archived reports without new old-component identity are rejected', () => {
    const live = JSON.parse(readFileSync(`${archived}-compat-old-upgrade-live-${archivedSuffix}.json`));
    const sourceRoot = '/home/coder/workspaces/happy-next';
    assert.throws(() => assertOldCliIdentityProof(live, {
        sourceRoot, oldCliIntegrity: oldIntegrity, allowUnboundUnitFixture: true,
    }));
    const oldLog = JSON.parse(readFileSync(`${archived}-old-agent-safe-${archivedSuffix}.log`, 'utf8'));
    assert.throws(() => assertOldServerIdentityProof(oldLog, 'old-agent-safe', {
        sourceRoot, cliEntrySha256: oldLog.formalEntrySha256, oldServerRevision: oldRevision,
    }));
});

test('archived App and restore logs exercise business-proof parser only', () => {
    const restore = JSON.parse(readFileSync(`${archived}-restore-${archivedSuffix}.json`));
    const expected = { contextSha256: restore.contextSha256,
        cliEntrySha256: hash(readFileSync(join(archivedRuntime, 'packages/happy-cli/dist/index.mjs'))) };
    const owned = mkdtempSync(join(tmpdir(), 'ai-team-compat-business-parser-'));
    try {
        for (const id of ['app-five', 'app-diagnostic', 'restore']) {
            const path = `${archived}-${id}-${archivedSuffix}.log`;
            const check = (input) => id === 'restore' ? assertRestoreBusinessProof(input)
                : assertAppBusinessProof(input, id, expected);
            assert.equal(check(ref(path)), undefined, `${id} archived parser baseline`);
            const mutations = id === 'app-five' ? [
                (lines) => { const row = JSON.parse(lines[0]); delete row.proof.provider;
                    lines[0] = JSON.stringify(row); },
                (lines) => { const row = JSON.parse(lines[4]); delete row.cleanup.residualAccounts;
                    lines[4] = JSON.stringify(row); },
            ] : id === 'app-diagnostic' ? [
                (lines) => { const row = JSON.parse(lines[0]); delete row.proof.deliveryNotInferred;
                    lines[0] = JSON.stringify(row); },
                (lines) => { lines.pop(); },
            ] : [(lines) => { lines.splice(2, 1); }, (lines) => { lines.pop(); }];
            for (const [index, mutate] of mutations.entries()) {
                const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
                mutate(lines);
                const changed = join(owned, `${id}-${index}.log`);
                writeFileSync(changed, `${lines.join('\n')}\n`, { flag: 'wx' });
                assert.throws(() => check(ref(changed)), `${id} missing business or cleanup proof`);
            }
        }
    } finally { rmSync(owned, { recursive: true, force: true }); }
});

// Set this only for a complete, new same-candidate matrix; archived deadline reports are never a baseline.
if (process.env.AI_TEAM_COMPAT_TEST_CURRENT === '1') test('current v2 evidence and structural negatives', () => {
    assert.ok(existsSync(`${prefix}-restore-${suffix}.json`)
        && existsSync(serverReport) && existsSync(imageReport), 'CURRENT_REPORTS_MISSING');
    const restore = JSON.parse(readFileSync(`${prefix}-restore-${suffix}.json`));
    const expected = {
        candidateSha256: JSON.parse(readFileSync(`${prefix}-compat-finish-live-${suffix}.json`)).candidateBeforeSha256,
        contextSha256: restore.contextSha256, sourceSha256: restore.sourceSha256,
        sourceRoot: restore.sourceRoot, artifactRoot: runtime,
        producerSha256: hash(readFileSync(new URL('./aiTeamProductionCompatibilityProduce.mjs', import.meta.url))),
        artifacts: restore.artifacts,
        cliEntrySha256: hash(readFileSync(join(runtime, 'packages/happy-cli/dist/index.mjs'))),
        oldCliIntegrity: oldIntegrity, oldServerRevision: oldRevision,
        migrationSha256: process.env.AI_TEAM_COMPAT_TEST_MIGRATION_SHA,
        migrationCount: Number(process.env.AI_TEAM_COMPAT_TEST_MIGRATION_COUNT),
        migrationInventoryComplete: true,
        freshBuildReport: join(runtime, 'consumer-build-report-root.json'),
        sourceSnapshot: process.env.AI_TEAM_COMPAT_TEST_SNAPSHOT,
    };
    assert.match(expected.migrationSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(expected.migrationCount) && expected.migrationCount > 0);
    assert.ok(expected.sourceSnapshot?.startsWith('/tmp/'));
    const baseline = createCompatibilityEvidenceV2({ casePrefix: prefix, caseSuffix: suffix,
        serverReport, imageReport }, expected);
    assert.equal(verifyCompatibilityEvidenceV2(baseline, expected), true);
    for (const field of ['candidateSha256', 'artifactContextSha256']) {
        const changed = structuredClone(baseline); changed[field] = '0'.repeat(64);
        assert.equal(verifyCompatibilityEvidenceV2(changed, expected), false, field);
    }
    const missing = structuredClone(baseline); delete missing.cases['compat-old-upgrade'];
    assert.equal(verifyCompatibilityEvidenceV2(missing, expected), false);
    const duplicate = structuredClone(baseline);
    duplicate.cases['old-agent-safe'].log = duplicate.cases['old-agent-safe'].wrapper;
    assert.equal(verifyCompatibilityEvidenceV2(duplicate, expected), false);
});

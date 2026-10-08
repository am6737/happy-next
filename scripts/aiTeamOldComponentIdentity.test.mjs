import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
    rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyPublishedNpmTree, verifyOldServerTrackedTree } from './aiTeamOldComponentIdentity.mjs';
import { assertOldCliIdentityProof, assertOldServerIdentityProof } from './aiTeamProductionCompatibilityEvidence.mjs';

const sourceRoot = '/home/coder/workspaces/happy-next';
const oldNpm = '/tmp/ai-team-published-old-root-u1u75t2c/package';
const revision = '08030b85829f85f4d6db32abf28c96f8e5a52329';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const results = [];
const run = (command, args, cwd) => {
    const child = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
    assert.equal(child.status, 0, `${command} exit ${child.status}; stderr withheld`);
};
const rejected = (id, condition, check, error) => {
    assert.throws(check, error);
    results.push({ id, condition, rejectedByIdentityCheck: true });
};

test('published npm packed execution tree and v2 identity proof', () => {
    const owner = mkdtempSync(join(tmpdir(), 'ai-team-published-old-'));
    const packageRoot = join(owner, 'package');
    try {
        copyFileSync(join(oldNpm, '..', 'package.tgz'), join(owner, 'package.tgz'));
        run('tar', ['-xzf', join(owner, 'package.tgz'), '-C', owner], owner);
        copyFileSync(join(oldNpm, 'package-lock.json'), join(packageRoot, 'package-lock.json'));
        mkdirSync(join(packageRoot, 'node_modules'));
        const identity = verifyPublishedNpmTree(packageRoot, sourceRoot);
        assert.equal(identity.members, 79);
        const archived = JSON.parse(readFileSync('/tmp/ai-team-deadline-compat-old-upgrade-live-root-20261008.json'));
        const old = { ...archived.oldPublishedCli, ...identity };
        const proof = { oldPublishedCli: old, oldPublishedCliAfter: identity,
            oldPublishedCliStable: true };
        const expected = { sourceRoot, oldCliIntegrity: identity.registryIntegrity,
            allowUnboundUnitFixture: true };
        assertOldCliIdentityProof(proof, expected);
        const wrongProof = { ...proof, oldPublishedCliAfter: {
            ...identity, packedTreeSha256: '0'.repeat(64) } };
        rejected('npm', 'reported packed tree identity differs from actual tree',
            () => assertOldCliIdentityProof(wrongProof, expected), /strictly deep-equal/);
        const chunk = 'dist/config-BhvYOE61.cjs';
        const chunkPath = join(packageRoot, chunk);
        writeFileSync(chunkPath, Buffer.concat([readFileSync(chunkPath), Buffer.from('\nmodified\n')]));
        rejected('npm', 'non-index chunk bytes changed',
            () => assertOldCliIdentityProof(proof, expected), /OLD_NPM_MEMBER_BYTES/);
        copyFileSync(join(oldNpm, chunk), chunkPath);
        chmodSync(chunkPath, 0o755);
        rejected('npm', 'non-index chunk mode changed',
            () => assertOldCliIdentityProof(proof, expected), /OLD_NPM_MEMBER_MODE/);
        chmodSync(chunkPath, 0o644);
        writeFileSync(join(packageRoot, 'dist/extra-execution.mjs'), 'export {}\n');
        rejected('npm', 'extra execution source',
            () => assertOldCliIdentityProof(proof, expected), /OLD_NPM_EXTRA_EXECUTION_FILE/);
    } finally { rmSync(owner, { recursive: true, force: true }); }
});

test('packed internal symlink resolves only to an owned regular member', () => {
    const owner = mkdtempSync(join(tmpdir(), 'ai-team-published-old-'));
    const packageRoot = join(owner, 'package');
    try {
        mkdirSync(packageRoot);
        mkdirSync(join(packageRoot, 'node_modules'));
        writeFileSync(join(packageRoot, 'file.txt'), 'packed bytes\n');
        symlinkSync('file.txt', join(packageRoot, 'link.txt'));
        writeFileSync(join(packageRoot, 'package-lock.json'), '{}\n');
        run('tar', ['-czf', join(owner, 'package.tgz'), '--transform=flags=r;s,^,package/,',
            '-C', packageRoot, 'file.txt', 'link.txt'], owner);
        const expectedIntegrity = integrity(readFileSync(join(owner, 'package.tgz')));
        assert.equal(verifyPublishedNpmTree(packageRoot, sourceRoot, expectedIntegrity).members, 2);
        rmSync(join(packageRoot, 'link.txt'));
        symlinkSync('../../outside', join(packageRoot, 'link.txt'));
        rejected('npm', 'packed symlink target changed',
            () => verifyPublishedNpmTree(packageRoot, sourceRoot, expectedIntegrity),
            /OLD_NPM_MEMBER_LINK/);
        run('tar', ['-czf', join(owner, 'package.tgz'), '--transform=flags=r;s,^,package/,',
            '-C', packageRoot, 'file.txt', 'link.txt'], owner);
        const escapeArchiveIntegrity = integrity(readFileSync(join(owner, 'package.tgz')));
        rejected('npm', 'matching packed symlink escapes owned root',
            () => verifyPublishedNpmTree(packageRoot, sourceRoot, escapeArchiveIntegrity),
            /OLD_IDENTITY_PATH_ESCAPE/);
    } finally { rmSync(owner, { recursive: true, force: true }); }
});

test('old Server Git blob/mode and v2 identity proof', () => {
    const owner = mkdtempSync(join(tmpdir(), 'happy-old-agent-prepared-'));
    try {
        run('git', ['clone', '--shared', '--no-checkout', '-q', sourceRoot, owner], sourceRoot);
        run('git', ['checkout', '--detach', '-q', revision], owner);
        const identity = verifyOldServerTrackedTree(owner, revision, sourceRoot);
        const log = JSON.parse(readFileSync('/tmp/ai-team-deadline-old-agent-safe-root-20261008.log'));
        Object.assign(log, { oldRootIdentityBefore: identity,
            oldRootIdentityAfter: identity, oldRootIdentityStable: true });
        const expected = { sourceRoot,
            cliEntrySha256: log.formalEntrySha256, oldServerRevision: revision };
        assertOldServerIdentityProof(log, 'old-agent-safe', expected);
        const wrongProof = { ...log, oldRootIdentityAfter: {
            ...identity, trackedTreeSha256: '0'.repeat(64) } };
        rejected('server', 'reported tracked tree identity differs from actual tree',
            () => assertOldServerIdentityProof(wrongProof, 'old-agent-safe', expected),
            /strictly deep-equal/);
        const source = join(owner, 'packages/happy-server/sources/app/api/routes/aiTeamRoutes.ts');
        writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('\n// changed\n')]));
        rejected('server', 'tracked route bytes changed without HEAD change',
            () => assertOldServerIdentityProof(log, 'old-agent-safe', expected),
            /OLD_SERVER_SOURCE_BYTES/);
        run('git', ['checkout', '--', 'packages/happy-server/sources/app/api/routes/aiTeamRoutes.ts'], owner);
        chmodSync(source, 0o755);
        rejected('server', 'tracked route Git mode changed without HEAD change',
            () => assertOldServerIdentityProof(log, 'old-agent-safe', expected),
            /OLD_SERVER_SOURCE_MODE/);
        chmodSync(source, 0o644);
        const extra = join(owner, 'packages/happy-server/sources/app/api/routes/extraIdentity.ts');
        writeFileSync(extra, 'export {}\n');
        rejected('server', 'extra executable route source',
            () => assertOldServerIdentityProof(log, 'old-agent-safe', expected),
            /OLD_SERVER_EXTRA_EXECUTION_SOURCE/);
    } finally { rmSync(owner, { recursive: true, force: true }); }
});

process.on('exit', () => {
    const path = process.env.AI_TEAM_OLD_IDENTITY_TEST_REPORT;
    if (path && !existsSync(path)) writeFileSync(path,
        `${JSON.stringify({ format: 'ai-team-old-identity-staged-test-v1',
            scope: 'isolated old copies and archived parser logs only; no provider or current candidate pass',
            results, productionReady: false }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareExecutionWorkspace, commitExecutionWorkspace } from '../packages/happy-cli/src/orchestrator/workspace';
import { verifyIntegrationRequest, saveIntegrationBinding, matchesIntegrationBinding } from '../packages/happy-cli/src/orchestrator/verifyIntegration';

// Real Git, no provider or external systems. A large blob must never turn a
// subprocess read error into an accepted deletion on both sides.
const directory = mkdtempSync(join(tmpdir(), 'happy-integration-read-failure-'));
const source = join(directory, 'source'); const root = join(directory, 'workspaces');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
try {
    execFileSync('git', ['init', '-b', 'main', source], { stdio: 'ignore' });
    git(source, ['config', 'user.name', 'Owned acceptance fixture']);
    git(source, ['config', 'user.email', 'fixture@example.invalid']);
    writeFileSync(join(source, 'README.md'), 'base\n'); git(source, ['add', '.']); git(source, ['commit', '-m', 'Base']);
    const alpha = await prepareExecutionWorkspace(root, source, 'alpha');
    const beta = await prepareExecutionWorkspace(root, source, 'beta');
    const aggregate = await prepareExecutionWorkspace(root, source, 'aggregate');
    git(alpha.worktreePath, ['mv', 'README.md', 'RENAMED.md']);
    writeFileSync(join(alpha.worktreePath, 'large.bin'), Buffer.alloc(2 * 1024 * 1024, 65));
    for (const name of ['审查\n\t文件.txt', '-literal.txt', ':literal.txt', '(wild*)?.txt', 'é.txt', 'e\u0301.txt',
        ':!victim.txt', ':(exclude)victim.txt', ':(glob)*.txt', '*.txt', '[literal].txt']) {
        writeFileSync(join(alpha.worktreePath, name), `Exact UTF-8 path: ${name}\n`);
    }
    const alphaCommit = commitExecutionWorkspace(alpha);
    writeFileSync(join(beta.worktreePath, 'beta.txt'), 'Exact beta\n'); const betaCommit = commitExecutionWorkspace(beta);
    git(aggregate.worktreePath, ['cherry-pick', alphaCommit, betaCommit]);
    const binding = { executionId: 'execution', dispatchToken: 'owned-token', taskId: 'aggregate', runId: 'owned-run' };
    saveIntegrationBinding(root, binding);
    const verify = () => {
        const expected = { ...binding, dispatchToken: undefined, machineId: 'owned-machine', baseCommit: aggregate.baseCommit,
            aggregateCommit: git(aggregate.worktreePath, ['rev-parse', 'HEAD']), members: [alpha, beta].map((item) => ({
                taskId: item.taskId, machineId: 'owned-machine', branchName: item.branchName,
                commitSha: git(item.worktreePath, ['rev-parse', 'HEAD']), baseCommit: item.baseCommit,
            })) };
        return verifyIntegrationRequest(root, 'owned-machine', { executionId: binding.executionId, dispatchToken: binding.dispatchToken,
            expectedHash: createHash('sha256').update(JSON.stringify(canonical(expected))).digest('hex'), expected, proof: {} },
            (executionId, dispatchToken, taskId, runId) => matchesIntegrationBinding(root, { executionId, dispatchToken, taskId, runId }));
    };
    assert.equal(verify().verified, true, 'Unchanged large file must verify or be explicitly blocked by a documented size policy');
    writeFileSync(join(aggregate.worktreePath, 'large.bin'), Buffer.alloc(2 * 1024 * 1024, 66));
    commitExecutionWorkspace(aggregate);
    const replacement = verify();
    writeFileSync(join(aggregate.worktreePath, 'large.bin'), Buffer.alloc(2 * 1024 * 1024, 65));
    commitExecutionWorkspace(aggregate);
    chmodSync(join(aggregate.worktreePath, 'large.bin'), 0o755);
    commitExecutionWorkspace(aggregate);
    const modeChange = verify();
    chmodSync(join(aggregate.worktreePath, 'large.bin'), 0o644);
    commitExecutionWorkspace(aggregate);
    writeFileSync(join(aggregate.worktreePath, 'README.md'), 'Unexpectedly restored old path\n');
    commitExecutionWorkspace(aggregate);
    const restoredRename = verify();
    console.log(JSON.stringify({ result: 'REAL_GIT_INTEGRATION_NEGATIVE_EVIDENCE',
        replacementVerified: replacement.verified, modeChangeVerified: modeChange.verified, restoredRenameVerified: restoredRename.verified }));
    assert.equal(replacement.verified, false, 'Two failed Git blob reads were accepted as identical deletions');
    assert.equal(modeChange.verified, false, 'Integration changed file mode without rejection');
    assert.equal(restoredRename.verified, false, 'Integration restored the deleted side of a rename without rejection');
    git(aggregate.worktreePath, ['rm', 'README.md']);
    commitExecutionWorkspace(aggregate);
    // A leading UTF-8 BOM is a valid literal filename character. A decoder
    // must preserve it rather than compare the absent, stripped path twice.
    const bomName = '\uFEFFliteral-bom.txt';
    writeFileSync(join(alpha.worktreePath, bomName), 'Exact leading BOM filename content\n');
    git(aggregate.worktreePath, ['cherry-pick', commitExecutionWorkspace(alpha)]);
    assert.equal(verify().verified, true, 'Literal UTF-8 BOM path was not preserved');
    writeFileSync(join(aggregate.worktreePath, bomName), 'Changed leading BOM filename content\n');
    commitExecutionWorkspace(aggregate);
    const bomReplacement = verify();
    console.log(JSON.stringify({ result: 'REAL_GIT_LITERAL_BOM_FILENAME_NEGATIVE_EVIDENCE',
        bomReplacementVerified: bomReplacement.verified }));
    writeFileSync(join(aggregate.worktreePath, bomName), 'Exact leading BOM filename content\n');
    commitExecutionWorkspace(aggregate);
    const rawName = Buffer.from([0x72, 0x61, 0x77, 0x2d, 0xff, 0x2e, 0x62, 0x69, 0x6e]);
    const rawPath = (cwd: string) => Buffer.concat([Buffer.from(`${cwd}/`), rawName]);
    writeFileSync(rawPath(alpha.worktreePath), 'Exact raw filename content\n');
    git(aggregate.worktreePath, ['cherry-pick', commitExecutionWorkspace(alpha)]);
    const baseline = verify();
    // An explicit policy rejecting non-UTF-8 Git paths is also safe, but it
    // must reject identity rather than silently omit these entries.
    const rawNamesSupported = baseline.verified;
    assert.ok(baseline.verified || baseline.errorCode === 'identity_changed');
    writeFileSync(rawPath(aggregate.worktreePath), 'Changed raw filename content\n');
    commitExecutionWorkspace(aggregate);
    const rawReplacement = verify();
    console.log(JSON.stringify({ result: 'REAL_GIT_RAW_FILENAME_NEGATIVE_EVIDENCE',
        rawNamesSupported, rawReplacementVerified: rawReplacement.verified }));
    assert.equal(rawReplacement.verified, false, 'Lossy UTF-8 Git path decoding accepted an altered blob as absent on both sides');
    assert.equal(bomReplacement.verified, false, 'UTF-8 BOM stripping accepted an altered blob as absent on both sides');
    console.log('REAL_GIT_INTEGRATION_BLOB_MODE_AND_RENAME_REJECTED_OK');
} finally { rmSync(directory, { recursive: true, force: true }); }

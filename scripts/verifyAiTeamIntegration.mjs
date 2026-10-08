import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (cwd, args, raw = false) => execFileSync('git', args, { cwd, encoding: raw ? undefined : 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (value) => assert.match(value, /^[0-9a-f]{40}$/, 'A full commit identity is required');
const safeFile = (file) => {
    assert.equal(isAbsolute(file), false, 'Repository file must be relative');
    assert.ok(file && !file.includes('\\') && !file.includes('\0') && !file.split('/').some((part) => !part || part === '.' || part === '..'), 'Unsafe repository file');
};
const commonDirectory = (cwd) => realpathSync(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim()));

// Independent acceptance: no model-provided success marker or output text is
// trusted. Inspect actual Git identities, patch integration and file bytes.
export function verifyAiTeamIntegration(manifest) {
    assert.ok(Array.isArray(manifest.children) && manifest.children.length >= 2, 'At least two real member tasks are required');
    sha(manifest.baseCommit); sha(manifest.integration.commitSha);
    const source = realpathSync(manifest.sourceRepository);
    const integration = realpathSync(manifest.integration.worktreePath);
    const common = commonDirectory(source);
    assert.equal(git(source, ['status', '--porcelain']).trim(), '', 'Source repository is dirty');
    assert.equal(commonDirectory(integration), common, 'Integration belongs to another repository');
    assert.notEqual(integration, source, 'Integration must use its own worktree');
    assert.equal(git(integration, ['status', '--porcelain']).trim(), '', 'Integration has uncommitted changes');
    assert.equal(git(integration, ['rev-parse', 'HEAD']).trim(), manifest.integration.commitSha, 'Integration HEAD mismatch');
    assert.equal(git(integration, ['branch', '--show-current']).trim(), manifest.integration.branchName, 'Integration branch mismatch');
    git(integration, ['merge-base', '--is-ancestor', manifest.baseCommit, manifest.integration.commitSha]);
    const taskIds = new Set(); const paths = new Set([source, integration]); const branches = new Set([manifest.integration.branchName]);
    for (const child of manifest.children) {
        assert.ok(child.taskId && !taskIds.has(child.taskId), 'Member task identities must be distinct'); taskIds.add(child.taskId);
        sha(child.commitSha);
        assert.notEqual(child.commitSha, manifest.baseCommit, 'Member task made no commit');
        const path = realpathSync(child.worktreePath);
        assert.ok(!paths.has(path), 'Members must use isolated worktrees'); paths.add(path);
        assert.ok(child.branchName && !branches.has(child.branchName), 'Members must use isolated branches'); branches.add(child.branchName);
        assert.equal(commonDirectory(path), common, 'Member belongs to another repository');
        assert.equal(git(path, ['branch', '--show-current']).trim(), child.branchName, 'Member branch mismatch');
        assert.equal(git(path, ['rev-parse', 'HEAD']).trim(), child.commitSha, 'Member HEAD mismatch');
        assert.equal(git(path, ['status', '--porcelain']).trim(), '', 'Member has uncommitted changes');
        git(path, ['merge-base', '--is-ancestor', manifest.baseCommit, child.commitSha]);
        // git cherry compares patch identity, so both merge and cherry-pick
        // strategies are accepted while missing member commits are rejected.
        const remaining = git(path, ['cherry', manifest.integration.commitSha, child.commitSha, manifest.baseCommit]).trim();
        assert.ok(!remaining.split('\n').some((line) => line.startsWith('+ ')), 'Integration is missing a member patch');
        assert.ok(Array.isArray(child.files) && child.files.length > 0, 'Member must provide exact file assertions');
        const changed = git(path, ['diff', '--name-only', '--no-renames', '-z', manifest.baseCommit, child.commitSha]).split('\0').filter(Boolean);
        const asserted = child.files.map((file) => file.repositoryPath);
        assert.equal(new Set(asserted).size, asserted.length, 'Duplicate member file assertions');
        assert.deepEqual([...asserted].sort(), [...changed].sort(), 'Assertions must cover every changed member file');
        for (const file of child.files) {
            safeFile(file.repositoryPath);
            const memberEntry = git(path, ['ls-tree', child.commitSha, '--', file.repositoryPath]).trim();
            const integratedEntry = git(integration, ['ls-tree', manifest.integration.commitSha, '--', file.repositoryPath]).trim();
            if (file.expectedAbsent === true) {
                assert.equal(memberEntry, '', 'Member deletion assertion mismatch');
                assert.equal(integratedEntry, '', 'Integration restored a deleted member file');
                continue;
            }
            assert.ok(memberEntry, 'Member asserted file does not exist');
            assert.equal(integratedEntry, memberEntry, 'Integration file mode or Git object mismatch');
            const expected = readFileSync(file.expectedLocalPath);
            const actual = git(path, ['show', `${child.commitSha}:${file.repositoryPath}`], true);
            const combined = git(integration, ['show', `${manifest.integration.commitSha}:${file.repositoryPath}`], true);
            assert.ok(actual.equals(expected), 'Member committed file bytes mismatch');
            assert.ok(combined.equals(expected), 'Integration committed file bytes mismatch');
        }
    }
    return { members: taskIds.size, integrationCommit: manifest.integration.commitSha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        assert.equal(process.argv.length, 3, 'Usage: node scripts/verifyAiTeamIntegration.mjs manifest.json');
        const result = verifyAiTeamIntegration(JSON.parse(readFileSync(process.argv[2], 'utf8')));
        console.log(JSON.stringify({ result: 'AI_TEAM_REAL_GIT_INTEGRATION_OK', ...result }));
    } catch (error) {
        // Only assertion descriptions are printed, never expected file bytes.
        console.error(error instanceof Error ? error.message : 'Integration verification failed');
        process.exitCode = 1;
    }
}

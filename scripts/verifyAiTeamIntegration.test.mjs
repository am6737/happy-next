import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAiTeamIntegration } from './verifyAiTeamIntegration.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
test('independently verifies real two-member cherry-pick and rejects incomplete or altered delivery', () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-team-integration-'));
    const source = join(root, 'source');
    try {
        execFileSync('git', ['init', '-b', 'main', source], { stdio: 'ignore' });
        git(source, 'config', 'user.name', 'Integration fixture'); git(source, 'config', 'user.email', 'fixture@example.invalid');
        writeFileSync(join(source, 'README.md'), 'Base\n'); git(source, 'add', '.'); git(source, 'commit', '-m', 'Base');
        const baseCommit = git(source, 'rev-parse', 'HEAD');
        const children = ['alpha', 'beta'].map((taskId) => {
            const worktreePath = join(root, taskId); const branchName = `fixture/${taskId}`;
            git(source, 'worktree', 'add', '-b', branchName, worktreePath, baseCommit);
            const expectedLocalPath = join(root, `${taskId}.expected`); const content = Buffer.from(`${taskId}\nExact bytes\n`, 'utf8');
            writeFileSync(expectedLocalPath, content); writeFileSync(join(worktreePath, `${taskId}.txt`), content);
            const binaryExpected = join(root, `${taskId}.binary.expected`);
            writeFileSync(binaryExpected, Buffer.from([0, 255, 13, 10]));
            writeFileSync(join(worktreePath, `${taskId}.bin`), Buffer.from([0, 255, 13, 10]));
            const renameFiles = [];
            if (taskId === 'alpha') {
                git(worktreePath, 'mv', 'README.md', 'RENAMED.md');
                const baseExpected = join(root, 'base.expected');
                writeFileSync(baseExpected, 'Base\n');
                renameFiles.push({ repositoryPath: 'README.md', expectedAbsent: true },
                    { repositoryPath: 'RENAMED.md', expectedLocalPath: baseExpected });
            }
            git(worktreePath, 'add', '.'); git(worktreePath, 'commit', '-m', taskId);
            return { taskId, worktreePath, branchName, commitSha: git(worktreePath, 'rev-parse', 'HEAD'), files: [{ repositoryPath: `${taskId}.txt`, expectedLocalPath }, { repositoryPath: `${taskId}.bin`, expectedLocalPath: binaryExpected }, ...renameFiles] };
        });
        const integration = { worktreePath: join(root, 'integration'), branchName: 'fixture/integration', commitSha: '' };
        git(source, 'worktree', 'add', '-b', integration.branchName, integration.worktreePath, baseCommit);
        git(integration.worktreePath, 'cherry-pick', children[0].commitSha);
        integration.commitSha = git(integration.worktreePath, 'rev-parse', 'HEAD');
        const manifest = { sourceRepository: source, baseCommit, children, integration };
        assert.throws(() => verifyAiTeamIntegration(manifest), /missing a member patch/);
        git(integration.worktreePath, 'cherry-pick', children[1].commitSha);
        integration.commitSha = git(integration.worktreePath, 'rev-parse', 'HEAD');
        assert.equal(verifyAiTeamIntegration(manifest).members, 2);
        assert.throws(() => verifyAiTeamIntegration({ ...manifest, children: [{ ...children[0], files: [children[0].files[0]] }, children[1]] }), /cover every changed member file/);
        assert.throws(() => verifyAiTeamIntegration({ ...manifest, children: [{ ...children[0], files: [...children[0].files, children[0].files[0]] }, children[1]] }), /Duplicate member file/);
        writeFileSync(children[0].files[0].expectedLocalPath, 'alpha\nExact bytes');
        assert.throws(() => verifyAiTeamIntegration(manifest), /file bytes mismatch/);
        writeFileSync(children[0].files[0].expectedLocalPath, 'alpha\nExact bytes\n');
        writeFileSync(join(source, 'unexpected.txt'), 'dirty');
        assert.throws(() => verifyAiTeamIntegration(manifest), /Source repository is dirty/);
        rmSync(join(source, 'unexpected.txt'));
        assert.throws(() => verifyAiTeamIntegration({ ...manifest, children: [children[0], children[0]] }), /identities must be distinct/);
        assert.throws(() => verifyAiTeamIntegration({ ...manifest, integration: { ...integration, commitSha: baseCommit } }), /HEAD mismatch/);
        const unrelated = join(root, 'unrelated');
        execFileSync('git', ['init', '-b', 'main', unrelated], { stdio: 'ignore' });
        assert.throws(() => verifyAiTeamIntegration({ ...manifest, children: [children[0], { ...children[1], worktreePath: unrelated }] }), /another repository/);
        assert.equal(verifyAiTeamIntegration(manifest).members, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

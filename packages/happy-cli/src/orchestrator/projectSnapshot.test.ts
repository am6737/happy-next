import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProjectSnapshot } from './projectSnapshot';

describe('project dispatch snapshot', () => {
  it('pins registered repository, machine, remote branch and base commit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-project-snapshot-'));
    const repo = join(directory, 'repo');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
      writeFileSync(join(repo, 'README.md'), 'base\n'); git(['add', '.']); git(['commit', '-m', 'base']);
      const baseCommit = git(['rev-parse', 'HEAD']);
      git(['remote', 'add', 'origin', 'https://github.com/example/project.git']);
      git(['update-ref', 'refs/remotes/origin/main', baseCommit]);
      const fields = { repositoryId: '123', repositoryFullName: 'example/project', machineId: 'machine',
        registeredRepoId: 'registered', registeredKvVersion: 1, workingDirectory: repo,
        defaultBranch: 'main', baseCommit };
      const snapshot = { projectId: 'project', version: 1, ...fields,
        snapshotHash: createHash('sha256').update(JSON.stringify(fields)).digest('hex') };
      expect(() => validateProjectSnapshot(snapshot, 'machine', repo)).not.toThrow();
      expect(() => validateProjectSnapshot({ ...snapshot, version: 2, baseCommit: 'a'.repeat(40) }, 'machine', repo))
        .toThrow(/hash changed/);
      expect(() => validateProjectSnapshot(snapshot, 'other', repo)).toThrow(/identity/);
      writeFileSync(join(repo, 'later.txt'), 'later\n'); git(['add', '.']); git(['commit', '-m', 'later']);
      expect(() => validateProjectSnapshot(snapshot, 'machine', repo)).toThrow(/base changed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

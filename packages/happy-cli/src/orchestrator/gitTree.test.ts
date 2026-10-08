import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { changedPaths, matchingChangedEntries } from './gitTree';

it('compares legal Git paths and modes without text normalization, rejecting undecodable names', () => {
  const repo = mkdtempSync(join(tmpdir(), 'happy-git-tree-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo,
    encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(repo, 'base'), 'base');
    git(['add', '--all']); git(['commit', '-q', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    const names = ['é snow.txt', 'line\nbreak.bin', 'binary data', '\uFEFFliteral-bom.txt',
      ':(glob)literal.txt', 'star*.txt'];
    writeFileSync(join(repo, names[0]), 'unicode\n');
    writeFileSync(join(repo, names[1]), Buffer.from([0, 255, 0, 1]));
    writeFileSync(join(repo, names[2]), 'executable\n');
    chmodSync(join(repo, names[2]), 0o755);
    writeFileSync(join(repo, names[3]), 'bom\n');
    writeFileSync(join(repo, names[4]), 'literal\n');
    writeFileSync(join(repo, names[5]), 'star\n');
    git(['add', '--all']); git(['commit', '-q', '-m', 'member']);
    const member = git(['rev-parse', 'HEAD']);
    expect(changedPaths(repo, base, member)).toEqual(expect.arrayContaining(names));
    expect(matchingChangedEntries(repo, repo, base, member, member)).toBe(true);
    writeFileSync(join(repo, names[3]), 'changed\n');
    git(['add', '--all']); git(['commit', '-q', '-m', 'alter-bom']);
    const altered = git(['rev-parse', 'HEAD']);
    expect(matchingChangedEntries(repo, repo, base, member, altered)).toBe(false);
    const raw = Buffer.concat([Buffer.from(`${repo}/raw-`), Buffer.from([255]), Buffer.from('.bin')]);
    writeFileSync(raw, Buffer.from([0, 255, 1]));
    git(['add', '--all']); git(['commit', '-q', '-m', 'raw']);
    const rawCommit = git(['rev-parse', 'HEAD']);
    expect(() => changedPaths(repo, member, rawCommit)).toThrow();
    expect(() => matchingChangedEntries(repo, repo, member, rawCommit, rawCommit)).toThrow();
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

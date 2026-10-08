import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { configuration } from '@/configuration';
import { verifyRegisteredRepo } from './registeredRepo';
import { validateProjectSnapshot } from './projectSnapshot';

const previousUrl = configuration.serverUrl;
afterEach(() => { (configuration as any).serverUrl = previousUrl; });

it('binds a registered ID to this account KV, canonical Git path, branch and snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'happy-registered-repo-'));
  const repo = join(directory, 'repo');
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  const server = createServer((request, response) => {
    const entries = request.headers.authorization === 'Bearer own-token'
      ? [{ id: 'registered', path: repo }] : [{ id: 'foreign', path: repo }];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ version: 2, value: Buffer.from(JSON.stringify(entries)).toString('base64') }));
  });
  try {
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'pipe' });
    git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(repo, 'README.md'), 'base\n'); git(['add', '.']); git(['commit', '-m', 'base']);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    (configuration as any).serverUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const request = { registeredRepoId: 'registered', workingDirectory: repo, defaultBranch: 'main' };
    const verified = await verifyRegisteredRepo('own-token', 'machine', request);
    expect(verified.registeredKvVersion).toBe(2);
    expect(verified.baseCommit).toBe(git(['rev-parse', 'HEAD']));
    expect(verified.commonGitDirHash).toBe(createHash('sha256').update(realpathSync(join(repo, '.git'))).digest('hex'));
    await expect(verifyRegisteredRepo('other-token', 'machine', request)).rejects.toThrow(/identity/);
    await expect(verifyRegisteredRepo('own-token', 'machine', { ...request, registeredRepoId: 'unknown' })).rejects.toThrow(/identity/);
    await expect(verifyRegisteredRepo('own-token', 'machine', { ...request, workingDirectory: directory })).rejects.toThrow(/identity/);
    const fields = { kind: 'local', repositoryId: null, repositoryFullName: null,
      commonGitDirHash: verified.commonGitDirHash, machineId: 'machine', registeredRepoId: 'registered',
      registeredKvVersion: 2, workingDirectory: repo, defaultBranch: 'main', baseCommit: verified.baseCommit } as const;
    const sorted = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
    const snapshot = { projectId: 'project', version: 1, ...fields,
      snapshotHash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex') };
    expect(() => validateProjectSnapshot(snapshot, 'machine', repo)).not.toThrow();
    writeFileSync(join(repo, 'later'), 'later'); git(['add', '.']); git(['commit', '-m', 'later']);
    expect(() => validateProjectSnapshot(snapshot, 'machine', repo)).toThrow(/base changed/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

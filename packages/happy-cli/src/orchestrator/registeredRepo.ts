import axios from 'axios';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { configuration } from '@/configuration';

type Request = { registeredRepoId: string; workingDirectory: string; defaultBranch: string };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function verifyRegisteredRepo(token: string, machineId: string, request: Request): Promise<{
  verified: true; registeredRepoId: string; registeredKvVersion: number;
  workingDirectory: string; commonGitDirHash: string; baseCommit: string;
}> {
  if (!request || typeof request.registeredRepoId !== 'string' || !request.registeredRepoId
    || typeof request.workingDirectory !== 'string' || !request.workingDirectory.startsWith('/')
    || typeof request.defaultBranch !== 'string'
    || !/^[A-Za-z0-9._/-]{1,200}$/.test(request.defaultBranch)
    || request.defaultBranch.startsWith('-') || request.defaultBranch.includes('..'))
    throw new Error('Invalid registered repository request');
  const key = `repos:${machineId}`;
  const response = await axios.get(`${configuration.serverUrl}/v1/kv/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, maxContentLength: 1_000_000,
  });
  if (typeof response.data?.value !== 'string' || response.data.value.length > 1_000_000)
    throw new Error('Registered repository list is unavailable');
  if (!Number.isSafeInteger(response.data.version) || response.data.version < 0)
    throw new Error('Registered repository version is invalid');
  const bytes = Buffer.from(response.data.value, 'base64');
  if (bytes.toString('base64') !== response.data.value) throw new Error('Registered repository list is invalid');
  const entries: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error('Registered repository list is invalid');
  const matches = entries.filter((entry): entry is { id: string; path: string } =>
    !!entry && typeof entry === 'object' && (entry as any).id === request.registeredRepoId
    && typeof (entry as any).path === 'string');
  if (matches.length !== 1 || matches[0].path !== request.workingDirectory)
    throw new Error('Registered repository identity does not match');
  const source = realpathSync(request.workingDirectory);
  if (source !== request.workingDirectory || realpathSync(git(source, ['rev-parse', '--show-toplevel'])) !== source)
    throw new Error('Registered repository path is not canonical');
  const common = realpathSync(git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const baseCommit = git(source, ['rev-parse', '--verify', `refs/heads/${request.defaultBranch}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('Registered repository commit is invalid');
  return { verified: true, registeredRepoId: request.registeredRepoId,
    registeredKvVersion: response.data.version, workingDirectory: source,
    commonGitDirHash: createHash('sha256').update(common).digest('hex'), baseCommit };
}

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export type ProjectSnapshot = { projectId: string; version: number; kind?: 'github' | 'local';
  repositoryId: string | null; repositoryFullName: string | null; commonGitDirHash?: string | null;
  machineId: string; registeredRepoId: string;
  registeredKvVersion: number; workingDirectory: string; defaultBranch: string;
  baseCommit: string; snapshotHash: string };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function githubFullName(remote: string): string | null {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return match?.[1].toLowerCase() ?? null;
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
export function validateProjectSnapshot(snapshot: ProjectSnapshot, machineId: string, source: string): void {
  if (!snapshot || !snapshot.projectId || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1
    || (snapshot.kind !== undefined && snapshot.kind !== 'local' && snapshot.kind !== 'github')
    || snapshot.machineId !== machineId || !snapshot.registeredRepoId
    || !Number.isSafeInteger(snapshot.registeredKvVersion) || snapshot.registeredKvVersion < 0
    || !/^[A-Za-z0-9._/-]{1,200}$/.test(snapshot.defaultBranch)
    || snapshot.defaultBranch.startsWith('-') || snapshot.defaultBranch.includes('..')
    || !/^[0-9a-f]{40}$/.test(snapshot.baseCommit) || !/^[0-9a-f]{64}$/.test(snapshot.snapshotHash))
    throw new Error('Project snapshot identity is invalid');
  const canonical = { repositoryId: snapshot.repositoryId, repositoryFullName: snapshot.repositoryFullName,
    machineId: snapshot.machineId, registeredRepoId: snapshot.registeredRepoId,
    registeredKvVersion: snapshot.registeredKvVersion, workingDirectory: snapshot.workingDirectory,
    defaultBranch: snapshot.defaultBranch, baseCommit: snapshot.baseCommit };
  const local = snapshot.kind === 'local';
  const hashed = local ? { kind: 'local', repositoryId: null, repositoryFullName: null,
    commonGitDirHash: snapshot.commonGitDirHash, machineId: snapshot.machineId,
    registeredRepoId: snapshot.registeredRepoId, registeredKvVersion: snapshot.registeredKvVersion,
    workingDirectory: snapshot.workingDirectory, defaultBranch: snapshot.defaultBranch,
    baseCommit: snapshot.baseCommit } : snapshot.kind === 'github' ? { kind: 'github', ...canonical } : canonical;
  if (createHash('sha256').update(JSON.stringify(local ? canonicalize(hashed) : hashed)).digest('hex') !== snapshot.snapshotHash)
    throw new Error('Project snapshot hash changed');
  if (local ? (snapshot.repositoryId !== null || snapshot.repositoryFullName !== null
      || !/^[0-9a-f]{64}$/.test(snapshot.commonGitDirHash ?? ''))
    : (typeof snapshot.repositoryId !== 'string' || !/^[1-9]\d{0,19}$/.test(snapshot.repositoryId)
      || typeof snapshot.repositoryFullName !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.repositoryFullName)))
    throw new Error('Project repository identity is invalid');
  if (realpathSync(source) !== realpathSync(snapshot.workingDirectory)
    || realpathSync(git(source, ['rev-parse', '--show-toplevel'])) !== realpathSync(source)
    || (local ? createHash('sha256').update(realpathSync(git(source,
      ['rev-parse', '--path-format=absolute', '--git-common-dir']))).digest('hex') !== snapshot.commonGitDirHash
      : githubFullName(git(source, ['remote', 'get-url', 'origin'])) !== snapshot.repositoryFullName!.toLowerCase())
    || git(source, ['rev-parse', local ? `refs/heads/${snapshot.defaultBranch}`
      : `refs/remotes/origin/${snapshot.defaultBranch}`]) !== snapshot.baseCommit
    || git(source, ['rev-parse', 'HEAD']) !== snapshot.baseCommit)
    throw new Error('Project repository or base changed since task creation');
}

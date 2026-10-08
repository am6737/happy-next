import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configuration } from '@/configuration';
import { acquireFileLock } from './fileLock';

function scalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new Error('Unsupported Codex provider configuration');
}

export function safeCodexConfig(source: string): string {
  const parsed = spawnSync('python3', ['-c',
    'import json,sys,tomllib; c=tomllib.load(open(sys.argv[1],"rb")); keys=("model","model_provider","model_reasoning_effort"); print(json.dumps({**{k:c[k] for k in keys if k in c},"model_providers":c.get("model_providers",{})}))', source],
  { encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000 });
  if (parsed.status !== 0) throw new Error('Codex configuration cannot be parsed safely');
  const config = JSON.parse(parsed.stdout) as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of ['model', 'model_provider', 'model_reasoning_effort']) {
    if (config[key] !== undefined) lines.push(`${key} = ${scalar(config[key])}`);
  }
  const providers = config.model_providers;
  if (providers !== undefined) {
    if (!providers || typeof providers !== 'object' || Array.isArray(providers))
      throw new Error('Invalid Codex model providers');
    for (const [name, value] of Object.entries(providers)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name) || !value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid Codex model provider');
      lines.push(`\n[model_providers.${name}]`);
      for (const key of ['name', 'base_url', 'env_key', 'wire_api', 'requires_openai_auth', 'request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms']) {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) lines.push(`${key} = ${scalar(item)}`);
      }
      if (Object.keys(value).some((key) => !['name', 'base_url', 'env_key', 'wire_api', 'requires_openai_auth',
        'request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms'].includes(key)))
        throw new Error('Unsupported Codex provider setting in isolated runtime');
    }
  }
  return `${lines.join('\n')}\n`;
}

function sessionMeta(path: string): { id: string; cwd: string } {
  if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || statSync(path).size > 512 * 1024 * 1024)
    throw new Error('SESSION_RECOVERY_REQUIRED: invalid session file');
  const fd = openSync(path, 'r');
  const bytes = Buffer.alloc(64 * 1024);
  try {
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    const lineEnd = bytes.subarray(0, count).indexOf(10);
    if (lineEnd < 0) throw new Error('SESSION_RECOVERY_REQUIRED: session metadata is too large');
    const first = JSON.parse(bytes.subarray(0, lineEnd).toString('utf8'));
    if (first?.type !== 'session_meta' || typeof first.payload?.id !== 'string'
      || typeof first.payload?.cwd !== 'string') throw new Error('SESSION_RECOVERY_REQUIRED: session metadata is invalid');
    return { id: first.payload.id, cwd: first.payload.cwd };
  } finally { closeSync(fd); }
}

function exactSessionFiles(root: string, id: string): string[] {
  const sessions = join(root, 'sessions');
  if (!existsSync(sessions)) return [];
  const found: string[] = [];
  const visit = (directory: string, depth: number) => {
    if (depth > 4 || lstatSync(directory).isSymbolicLink())
      throw new Error('SESSION_RECOVERY_REQUIRED: unsafe session directory');
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) throw new Error('SESSION_RECOVERY_REQUIRED: symlink in sessions');
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile() && name.endsWith(`-${id}.jsonl`)) found.push(path);
    }
  };
  visit(sessions, 0);
  return found;
}

function ensureSession(source: string, destination: string, id: string, worktree: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('SESSION_RECOVERY_REQUIRED: invalid session ID');
  const privateFiles = exactSessionFiles(destination, id);
  if (privateFiles.length > 1) throw new Error('SESSION_RECOVERY_REQUIRED: duplicate private session');
  if (privateFiles.length === 1) {
    const meta = sessionMeta(privateFiles[0]);
    if (meta.id !== id || meta.cwd !== worktree)
      throw new Error('SESSION_RECOVERY_REQUIRED: private session identity changed');
    return;
  }
  const legacyFiles = exactSessionFiles(source, id);
  if (legacyFiles.length !== 1) throw new Error('SESSION_RECOVERY_REQUIRED: exact legacy session unavailable');
  const meta = sessionMeta(legacyFiles[0]);
  if (meta.id !== id || meta.cwd !== worktree)
    throw new Error('SESSION_RECOVERY_REQUIRED: legacy session belongs to another workspace');
  const target = join(destination, 'sessions', relative(join(source, 'sessions'), legacyFiles[0]));
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    copyFileSync(legacyFiles[0], temporary);
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}

function privatePath(taskId: string): string {
  return join(configuration.happyHomeDir, 'orchestrator-codex',
    createHash('sha256').update(taskId).digest('hex'));
}

export function cleanupIsolatedCodexAuth(taskId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(taskId)) return;
  const path = privatePath(taskId);
  const marker = join(path, '.auth-copy-owner');
  if (!existsSync(marker)) return;
  const fd = openSync(marker, 'r');
  const bytes = Buffer.alloc(256);
  try {
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (bytes.subarray(0, count).toString('utf8') !== taskId) return;
  } finally { closeSync(fd); }
  rmSync(join(path, 'auth.json'), { force: true });
  rmSync(marker, { force: true });
}

export async function cleanupStaleCodexAuth(workspaceRoot: string): Promise<void> {
  if (!existsSync(workspaceRoot)) return;
  for (const file of readdirSync(workspaceRoot).filter((name) => /^task-[0-9a-f]{64}\.json$/.test(name))) {
    try {
      const saved = JSON.parse(readFileSync(join(workspaceRoot, file), 'utf8')) as { taskId?: string; worktreePath?: string };
      if (!saved.taskId || !saved.worktreePath || !saved.worktreePath.startsWith(`${workspaceRoot}/`)) continue;
      const lock = await acquireFileLock(`${saved.worktreePath}.execution.lock`, 0);
      try { cleanupIsolatedCodexAuth(saved.taskId); }
      finally { await lock.release(); }
    } catch { /* Another execution owns the task, or this record requires manual inspection. */ }
  }
}

export function prepareIsolatedCodexHome(taskId: string, worktree: string,
  resume?: { sessionId: string; worktree: string }):
  { path: string; cleanup: () => void } {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(taskId)) throw new Error('Invalid task identity for Codex isolation');
  if (!worktree.startsWith('/') || resume && resume.worktree !== worktree)
    throw new Error('Invalid Codex task worktree identity');
  const source = process.env.CODEX_HOME || join(homedir(), '.codex');
  const root = join(configuration.happyHomeDir, 'orchestrator-codex');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = privatePath(taskId);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (resume) ensureSession(source, path, resume.sessionId, resume.worktree);
  const sourceConfig = join(source, 'config.toml');
  const safe = existsSync(sourceConfig) ? safeCodexConfig(sourceConfig) : '';
  writeFileSync(join(path, 'config.toml'), `${safe}\n[projects.${JSON.stringify(worktree)}]\ntrust_level = "untrusted"\n`, { mode: 0o600 });
  const sourceAuth = join(source, 'auth.json');
  const targetAuth = join(path, 'auth.json');
  rmSync(targetAuth, { force: true });
  if (existsSync(sourceAuth)) {
    // Read only the isolated copy; never mutate the shared OAuth file.
    writeFileSync(join(path, '.auth-copy-owner'), taskId, { mode: 0o600 });
    copyFileSync(sourceAuth, targetAuth);
    chmodSync(targetAuth, 0o600);
  }
  return { path, cleanup: () => cleanupIsolatedCodexAuth(taskId) };
}

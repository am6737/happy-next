import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eventIdentityHash } from './eventQueue';
import type { OrchestratorDispatchPayload } from './common';
import { requiresTaskSkillDownload } from './common';
import { acquireFileLock } from './fileLock';
import { requireUnsupportedArchiveCapacity } from './unsupportedArchive';

type TelemetryKind = 'event' | 'usage';
type LegacyBinding = { executionId: string; runId: string; taskId: string;
  machineId: string; dispatchTokenHash: string };
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const bindingPath = (root: string, executionId: string) =>
  join(root, 'legacy-telemetry', `${sha256(executionId)}.json`);

export function unsupportedTelemetryRoute(error: unknown, executionId: string, kind: TelemetryKind): boolean {
  const response = (error as { response?: { status?: unknown; data?: unknown } })?.response;
  const requestUrl = (error as { config?: { url?: unknown; method?: unknown } })?.config;
  if (response?.status !== 404 || typeof requestUrl?.url !== 'string'
    || String(requestUrl.method).toLowerCase() !== 'post') return false;
  let path: string;
  try {
    const url = new URL(requestUrl.url);
    if (url.search || url.hash) return false;
    path = url.pathname;
  } catch { return false; }
  const prefix = `/v1/ai-team/executions/${encodeURIComponent(executionId)}`;
  const expected = kind === 'event' ? [`${prefix}/capabilities`, `${prefix}/events`]
    : [`${prefix}/capabilities`, `${prefix}/usage-deltas`];
  const data = response.data as { statusCode?: unknown; error?: unknown; message?: unknown;
    method?: unknown; path?: unknown } | null;
  const fastifyDefault = data?.statusCode === 404 && data.error === 'Not Found'
    && data.message === `Route POST:${path} not found`;
  const oldCustom = !!data && Object.keys(data).sort().join(',') === 'error,method,path'
    && data.error === 'Not found' && data.method === 'POST' && data.path === path;
  return expected.includes(path) && (fastifyDefault || oldCustom);
}

export function allowLegacyTelemetryExecution(payload: OrchestratorDispatchPayload, error: unknown): boolean {
  if (requiresTaskSkillDownload(payload) || payload.templateProposalScope) return false;
  if ((error as { telemetryPreflightOperation?: unknown })?.telemetryPreflightOperation !== 'event') return false;
  if (!unsupportedTelemetryRoute(error, payload.executionId, 'event')) return false;
  const requestUrl = (error as { config?: { url?: unknown } })?.config?.url;
  try {
    const url = new URL(String(requestUrl));
    return !url.search && !url.hash && url.pathname
      === `/v1/ai-team/executions/${encodeURIComponent(payload.executionId)}/capabilities`;
  } catch { return false; }
}

export async function saveLegacyTelemetryBinding(root: string, payload: OrchestratorDispatchPayload,
  machineId: string): Promise<void> {
  const directory = join(root, 'legacy-telemetry');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const binding: LegacyBinding = { executionId: payload.executionId, runId: payload.runId,
    taskId: payload.taskId, machineId, dispatchTokenHash: sha256(payload.dispatchToken) };
  const record = JSON.stringify(binding);
  const lock = await acquireFileLock(join(directory, '.queue.lock'), 30);
  try {
    const path = bindingPath(root, payload.executionId);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0)
        throw new Error('Legacy telemetry binding is unsafe');
      if (await readFile(path, 'utf8') !== record) throw new Error('Legacy telemetry identity changed');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, record, { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  } finally { await lock.release(); }
}

export async function readLegacyTelemetryBinding(root: string, executionId: string,
  dispatchToken: string): Promise<LegacyBinding | null> {
  const path = bindingPath(root, executionId);
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const stat = await lstat(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0)
    throw new Error('Legacy telemetry binding is unsafe');
  const binding = JSON.parse(raw) as LegacyBinding;
  if (binding.executionId !== executionId || binding.dispatchTokenHash !== sha256(dispatchToken)
    || typeof binding.machineId !== 'string' || !binding.machineId
    || typeof binding.runId !== 'string' || !binding.runId
    || typeof binding.taskId !== 'string' || !binding.taskId)
    throw new Error('Legacy telemetry binding identity changed');
  return binding;
}

export async function verifyLegacyTelemetryArchive(root: string, executionId: string,
  machineId: string): Promise<void> {
  await requireUnsupportedArchiveCapacity([join(root, 'events'), join(root, 'usage')]);
  let terminal = false;
  for (const kind of ['events', 'usage'] as const) {
    const directory = join(root, kind, 'unsupported');
    let files: string[];
    try { files = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const file of files.filter((entry) => entry.startsWith(`${sha256(executionId)}-`) && entry.endsWith('.json'))) {
      const path = join(directory, file);
      const contents = await readFile(path);
      const stat = await lstat(path);
      const reasonPath = `${path}.reason`;
      const reasonStat = await lstat(reasonPath);
      const reason = JSON.parse(await readFile(reasonPath, 'utf8')) as { reason?: unknown; sha256?: unknown; bytes?: unknown };
      const item = JSON.parse(contents.toString('utf8')) as { executionId?: unknown; machineId?: unknown;
        kind?: unknown; phase?: unknown };
      if (!stat.isFile() || !reasonStat.isFile() || (stat.mode & 0o077) !== 0
        || (reasonStat.mode & 0o077) !== 0 || item.executionId !== executionId
        || item.machineId !== machineId || reason.reason !== 'TELEMETRY_ENDPOINT_UNSUPPORTED'
        || reason.sha256 !== sha256(contents) || reason.bytes !== contents.length)
        throw new Error('Legacy telemetry archive identity changed');
      if (kind === 'events' && item.kind === 'status' && item.phase === 'finished') terminal = true;
    }
  }
  if (!terminal) throw new Error('Legacy telemetry terminal event is not durably archived');
}

export async function hasUnsupportedTelemetry(eventRoot: string, usageRoot: string, executionId: string): Promise<boolean> {
  const prefix = `${eventIdentityHash(executionId)}-`;
  for (const root of [eventRoot, usageRoot]) {
    try {
      if ((await readdir(join(root, 'unsupported'))).some((file) => file.startsWith(prefix) && file.endsWith('.json')))
        return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return false;
}

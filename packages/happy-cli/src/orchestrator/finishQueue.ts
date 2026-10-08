import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiClient } from '@/api/api';
import { acquireFileLock } from './fileLock';

type Report = Parameters<ApiClient['reportOrchestratorExecutionFinish']>[0];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const name = (id: string) => `${hash(id)}.json`;
export function finishQueuePath(home: string, serverUrl: string, accountPublicKey: string): string {
  return join(home, 'orchestrator-finish-queue', hash(`${serverUrl}\0${accountPublicKey}`));
}

export async function enqueueFinish(root: string, report: Report): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 45);
  try {
    const destination = join(root, name(report.executionId));
    try {
      const existing = JSON.parse(await readFile(destination, 'utf8')) as Report;
      if (existing.dispatchToken !== report.dispatchToken) throw new Error('Finish report belongs to another dispatch owner');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(root, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(report), { mode: 0o600, flag: 'wx' }); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  } finally { await lock.release(); }
}

export async function flushFinishes(root: string, send: (report: Report) => Promise<void>, onError?: (file: string, error: unknown) => void,
  canSend?: (report: Report) => boolean | Promise<boolean>,
  prepare?: (report: Report) => Report | Promise<Report>): Promise<void> {
  let files: string[];
  try { files = await readdir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const lock = await acquireFileLock(join(root, '.queue.lock'), 0);
  try {
    for (const file of files.filter((entry) => entry.endsWith('.json'))) {
      const path = join(root, file);
      try {
        const report = JSON.parse(await readFile(path, 'utf8')) as Report;
        if (!report.executionId || !report.dispatchToken || name(report.executionId) !== file) throw new Error('Invalid finish report identity');
        if (canSend && !await canSend(report)) continue;
        await send(prepare ? await prepare(report) : report);
        await rm(path);
      } catch (error) { onError?.(file, error); }
    }
  } finally { await lock.release(); }
}

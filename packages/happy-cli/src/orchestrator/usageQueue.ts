import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireFileLock } from './fileLock';
import { archiveUnsupported } from './unsupportedArchive';

export type UsageDelta = { executionId: string; machineId: string; sourceEventId: string;
  provider: string; model: string; inputTokens: number; outputTokens: number;
  costMicros: null; pricingVersion: null; measuredAt: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fileName = (item: UsageDelta) => `${hash(item.executionId)}-${hash(item.sourceEventId)}.json`;

export async function enqueueUsage(root: string, item: UsageDelta): Promise<void> {
  if (!item.executionId || !item.machineId || !item.sourceEventId
    || !Number.isSafeInteger(item.inputTokens) || item.inputTokens < 0
    || !Number.isSafeInteger(item.outputTokens) || item.outputTokens < 0
    || item.costMicros !== null || item.pricingVersion !== null)
    throw new Error('Invalid usage delta');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 30);
  try {
    const destination = join(root, fileName(item));
    try {
      const prior = await readFile(destination, 'utf8');
      if (prior !== JSON.stringify(item)) throw new Error('Usage delta identity changed');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(root, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(item), { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  } finally { await lock.release(); }
}

export async function flushUsage(root: string, send: (item: UsageDelta) => Promise<void>,
  onError?: (file: string, error: unknown) => void,
  isUnsupported?: (item: UsageDelta, error: unknown) => boolean): Promise<Set<string>> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const pending = new Set<string>();
  const lock = await acquireFileLock(join(root, '.queue.lock'), 0);
  try {
    const files = await readdir(root);
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      let item: UsageDelta | undefined;
      try {
        const path = join(root, file);
        item = JSON.parse(await readFile(path, 'utf8')) as UsageDelta;
        if (!item.executionId || !item.sourceEventId || fileName(item) !== file)
          throw new Error('Invalid usage record');
        if (pending.has(hash(item.executionId))) continue;
        await send(item);
        await rm(path);
      } catch (error) {
        if (item && isUnsupported?.(item, error)) {
          try { await archiveUnsupported(root, file); continue; }
          catch (archiveError) { error = archiveError; }
        }
        const match = /^([0-9a-f]{64})-/.exec(file);
        if (match) pending.add(match[1]);
        onError?.(file, error);
      }
    }
    return pending;
  } finally { await lock.release(); }
}

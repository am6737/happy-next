import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireFileLock } from './fileLock';
import { archiveUnsupported } from './unsupportedArchive';

export type ExecutionEvent = { eventId: string; executionId: string; machineId: string;
  seq: number; kind: 'status' | 'tool' | 'result'; phase: string; occurredAt: string; summary: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fileName = (event: ExecutionEvent) => `${hash(event.executionId)}-${String(event.seq).padStart(6, '0')}.json`;

export async function enqueueEvent(root: string, event: ExecutionEvent): Promise<void> {
  if (!event.executionId || !event.machineId || !Number.isSafeInteger(event.seq) || event.seq < 1
    || !/^[a-z_]{1,100}$/.test(event.phase) || Buffer.byteLength(event.summary) > 2_000)
    throw new Error('Invalid execution event');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 30);
  try {
    const destination = join(root, fileName(event));
    try {
      const prior = await readFile(destination, 'utf8');
      if (prior !== JSON.stringify(event)) throw new Error('Execution event identity changed');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(root, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  } finally { await lock.release(); }
}

export async function appendExecutionEvent(root: string, event: Omit<ExecutionEvent, 'eventId' | 'seq'>): Promise<ExecutionEvent> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 30);
  try {
    const sequencePath = join(root, `${hash(event.executionId)}.seq`);
    let previous = 0;
    try {
      const raw = await readFile(sequencePath, 'utf8');
      if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error('Invalid event sequence');
      previous = Number(raw);
      if (!Number.isSafeInteger(previous)) throw new Error('Invalid event sequence');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const seq = previous + 1;
    if (!Number.isSafeInteger(seq)) throw new Error('Event sequence exhausted');
    const next = { ...event, seq, eventId: `${event.executionId}:${seq}` };
    if (!/^[a-z_]{1,100}$/.test(next.phase) || Buffer.byteLength(next.summary) > 2_000)
      throw new Error('Invalid execution event');
    const temporary = join(root, `${randomUUID()}.tmp`);
    const counterTemporary = join(root, `${randomUUID()}.tmp`);
    try {
      await writeFile(counterTemporary, String(seq), { mode: 0o600, flag: 'wx' });
      await rename(counterTemporary, sequencePath);
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(root, fileName(next)));
    } finally {
      await rm(temporary, { force: true });
      await rm(counterTemporary, { force: true });
    }
    return next;
  } finally { await lock.release(); }
}

export async function flushEvents(root: string, send: (event: ExecutionEvent) => Promise<void>,
  onError?: (file: string, error: unknown) => void,
  isUnsupported?: (event: ExecutionEvent, error: unknown) => boolean): Promise<Set<string>> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const pending = new Set<string>();
  const lock = await acquireFileLock(join(root, '.queue.lock'), 0);
  try {
    const files = await readdir(root);
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      let event: ExecutionEvent | undefined;
      try {
        const path = join(root, file);
        event = JSON.parse(await readFile(path, 'utf8')) as ExecutionEvent;
        if (!event.executionId || !event.machineId || !Number.isSafeInteger(event.seq)
          || fileName(event) !== file) throw new Error('Invalid event record');
        if (pending.has(hash(event.executionId))) continue;
        await send(event);
        await rm(path);
      } catch (error) {
        if (event && isUnsupported?.(event, error)) {
          try { await archiveUnsupported(root, file); continue; }
          catch (archiveError) { error = archiveError; }
        }
        const match = /^([0-9a-f]{64})-/.exec(file);
        if (match) pending.add(match[1]);
        onError?.(file, error);
      }
    }
    // File names use execution hashes, matching the finish queue's identity key.
    return pending;
  } finally { await lock.release(); }
}

export function eventIdentityHash(executionId: string): string { return hash(executionId); }

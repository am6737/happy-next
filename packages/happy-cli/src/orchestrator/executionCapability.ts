import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireFileLock } from './fileLock';

export type ExecutionCapability = { token: string; protocolVersion: 1;
  allowedOps: string[]; expiresAt: string; recoveryMode?: 'drain' };
export type PersistedExecutionCapability = { dispatchToken: string; capability: ExecutionCapability;
  originalCapability?: ExecutionCapability; recoveryId?: string; recoveryGeneration?: number };
const name = (executionId: string) => `${createHash('sha256').update(executionId).digest('hex')}.json`;
const valid = (value: ExecutionCapability): boolean => value?.protocolVersion === 1
  && (value.recoveryMode === undefined || value.recoveryMode === 'drain')
  && /^[0-9a-f]{64}$/.test(value.token) && Array.isArray(value.allowedOps)
  && value.allowedOps.length <= 16 && value.allowedOps.every((op) => typeof op === 'string'
    && /^[a-z_]{1,32}$/.test(op))
  && (value.recoveryMode !== 'drain'
    || [...value.allowedOps].sort().join(',') === 'event,finish,usage')
  && Number.isFinite(Date.parse(value.expiresAt));

export async function saveExecutionCapability(root: string, executionId: string,
  dispatchToken: string, value: ExecutionCapability, allowDrain = false,
  recoveryId?: string, recoveryGeneration?: number): Promise<void> {
  if (!valid(value) || !executionId || !dispatchToken
    || (value.recoveryMode === 'drain' && (!allowDrain
      || [...value.allowedOps].sort().join(',') !== 'event,finish,usage'
      || !recoveryId || !/^[A-Za-z0-9_-]{8,256}$/.test(recoveryId)
      || !Number.isSafeInteger(recoveryGeneration) || recoveryGeneration! < 1)))
    throw new Error('Invalid execution capability');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 30);
  try {
    const target = join(root, name(executionId));
    let hadPrevious = false;
    let originalCapability: ExecutionCapability | undefined;
    try {
      const previous = JSON.parse(await readFile(target, 'utf8')) as {
        executionId: string } & PersistedExecutionCapability;
      hadPrevious = true;
      if (previous.executionId !== executionId || previous.dispatchToken !== dispatchToken)
        throw new Error('Execution capability owner changed');
      if (previous.capability.token === value.token) return;
      if (Date.parse(value.expiresAt) < Date.parse(previous.capability.expiresAt))
        throw new Error('Execution capability renewal moved expiry backwards');
      if (value.recoveryMode === 'drain') {
        if (Date.parse(previous.capability.expiresAt) > Date.now()
          || !previous.capability.allowedOps.includes('finish'))
          throw new Error('Execution capability drain owner changed');
        if (previous.capability.recoveryMode === 'drain') {
          if (!previous.originalCapability || !valid(previous.originalCapability)
            || previous.recoveryId !== recoveryId
            || !Number.isSafeInteger(previous.recoveryGeneration)
            || recoveryGeneration! <= previous.recoveryGeneration!)
            throw new Error('Execution capability drain generation changed');
          originalCapability = previous.originalCapability;
        } else {
          if (recoveryGeneration !== 1) throw new Error('Invalid initial drain generation');
          originalCapability = previous.capability;
        }
      } else if (previous.capability.recoveryMode === 'drain'
        || [...value.allowedOps].sort().join('\0') !== [...previous.capability.allowedOps].sort().join('\0'))
        throw new Error('Execution capability renewal changed scope');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (value.recoveryMode === 'drain' && (!hadPrevious || Date.parse(value.expiresAt) <= Date.now()))
      throw new Error('Execution capability drain has no expired owner');
    const temporary = join(root, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ executionId, dispatchToken, capability: value,
        ...(originalCapability ? { originalCapability, recoveryId, recoveryGeneration } : {}) }),
        { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  } finally { await lock.release(); }
}

export async function loadExecutionCapability(root: string, executionId: string): Promise<{
  dispatchToken: string; capability: ExecutionCapability;
  originalCapability?: ExecutionCapability; recoveryId?: string; recoveryGeneration?: number } | null> {
  let raw: string;
  try { raw = await readFile(join(root, name(executionId)), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const item = JSON.parse(raw) as { executionId: string } & PersistedExecutionCapability;
  if (item.executionId !== executionId || !item.dispatchToken || !valid(item.capability))
    throw new Error('Invalid persisted execution capability');
  if (item.capability.recoveryMode === 'drain' && (item.originalCapability !== undefined
    || item.recoveryId !== undefined || item.recoveryGeneration !== undefined)
    && (!item.originalCapability || !valid(item.originalCapability)
    || item.originalCapability.recoveryMode || !item.recoveryId
    || !/^[A-Za-z0-9_-]{8,256}$/.test(item.recoveryId)
    || !Number.isSafeInteger(item.recoveryGeneration) || item.recoveryGeneration! < 1))
    throw new Error('Invalid persisted execution recovery proof');
  return { dispatchToken: item.dispatchToken, capability: item.capability,
    ...(item.originalCapability ? { originalCapability: item.originalCapability } : {}),
    ...(item.recoveryId ? { recoveryId: item.recoveryId } : {}),
    ...(item.recoveryGeneration ? { recoveryGeneration: item.recoveryGeneration } : {}) };
}

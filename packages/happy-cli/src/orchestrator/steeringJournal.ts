import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SteeringRecord = { steeringId: string; executionId: string; dispatchToken: string;
  taskId: string; runId: string; state: 'injecting' | 'injected' | 'finished' };
function pathFor(root: string, executionId: string): string {
  return join(root, `steering-${createHash('sha256').update(executionId).digest('hex')}.json`);
}
export function readSteering(root: string, executionId: string): SteeringRecord | null {
  try { return JSON.parse(readFileSync(pathFor(root, executionId), 'utf8')) as SteeringRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function steeringReplay(root: string, identity: Pick<SteeringRecord, 'steeringId' | 'executionId' | 'dispatchToken'>):
  'new' | 'ack' | 'reject' {
  const prior = readSteering(root, identity.executionId);
  if (!prior) return 'new';
  if (prior.dispatchToken !== identity.dispatchToken || prior.steeringId !== identity.steeringId)
    return 'reject';
  return prior.state === 'injected' ? 'ack' : 'reject';
}
export function writeSteering(root: string, record: SteeringRecord): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = pathFor(root, record.executionId);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
export function unfinishedSteering(root: string): SteeringRecord[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => /^steering-[0-9a-f]{64}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as SteeringRecord)
    .filter((record) => record.state !== 'finished');
}

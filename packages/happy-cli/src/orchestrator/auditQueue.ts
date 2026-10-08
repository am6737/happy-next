import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalOperation } from './approvalJournal';
import { inspectUnsupportedArchives } from './unsupportedArchive';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function inspectOrchestratorAudit(root: string, now = Date.now()) {
  const rows: Array<{ executionHash: string; operationId: string; actionHash: string;
    state: ApprovalOperation['state']; expired: boolean; acceptedFinish: boolean;
    needsReview: boolean }> = [];
  let invalid = 0;
  let total = 0;
  let needsReview = 0;
  const byState: Record<ApprovalOperation['state'], number> = {
    requested: 0, approved: 0, rejected: 0, invoking: 0, invoked: 0 };
  const directory = join(root, 'approvals');
  let entries: string[] = [];
  try { entries = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const file of entries.filter((entry) => entry.endsWith('.json'))) {
    total++;
    try {
      const path = join(directory, file);
      if (!(await lstat(path)).isFile()) throw new Error('Invalid approval file');
      const row = JSON.parse(await readFile(path, 'utf8')) as ApprovalOperation;
      if (!row.executionId || !/^[0-9a-f]{64}$/.test(row.operationId)
        || !/^[0-9a-f]{64}$/.test(row.actionHash)
        || !['requested', 'approved', 'rejected', 'invoking', 'invoked'].includes(row.state)
        || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error('Invalid approval record');
      byState[row.state]++;
      const expired = Date.parse(row.expiresAt) <= now;
      const review = row.state !== 'rejected' && !row.acceptedFinish;
      if (review) needsReview++;
      rows.push({ executionHash: digest(row.executionId),
        operationId: row.operationId, actionHash: row.actionHash, state: row.state,
        expired, acceptedFinish: row.acceptedFinish === true, needsReview: review });
    } catch { invalid++; }
  }
  const unsupported = await inspectUnsupportedArchives([join(root, 'events'), join(root, 'usage')]);
  const unsupportedRows: Array<{ queue: 'event' | 'usage'; recordHash: string;
    bytes: number; reason: 'TELEMETRY_ENDPOINT_UNSUPPORTED' | 'INVALID_REASON' }> = [];
  let unsupportedInvalid = 0;
  for (const [queue, directory] of [['event', 'events'], ['usage', 'usage']] as const) {
    let files: string[] = [];
    try { files = await readdir(join(root, directory, 'unsupported')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const file of files.filter((entry) => !entry.endsWith('.reason'))) {
      try {
        const entry = await lstat(join(root, directory, 'unsupported', file));
        if (!entry.isFile()) throw new Error('Invalid archive entry');
        const reason = await readFile(join(root, directory, 'unsupported', `${file}.reason`), 'utf8');
        const validReason = reason === 'TELEMETRY_ENDPOINT_UNSUPPORTED\n';
        if (!validReason) unsupportedInvalid++;
        unsupportedRows.push({ queue, recordHash: digest(file), bytes: entry.size,
          reason: validReason ? 'TELEMETRY_ENDPOINT_UNSUPPORTED' : 'INVALID_REASON' });
      } catch { unsupportedInvalid++; }
    }
  }
  unsupportedRows.sort((a, b) => a.recordHash.localeCompare(b.recordHash));
  let capabilityFiles: string[] = [];
  try { capabilityFiles = await readdir(join(root, 'capabilities')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let expiredCapabilities = 0;
  let invalidCapabilities = 0;
  let capabilityTotal = 0;
  for (const file of capabilityFiles.filter((entry) => entry.endsWith('.json'))) {
    capabilityTotal++;
    try {
      const path = join(root, 'capabilities', file);
      if (!(await lstat(path)).isFile()) throw new Error('Invalid capability file');
      const record = JSON.parse(await readFile(path, 'utf8')) as {
        executionId?: string; capability?: { expiresAt?: string } };
      if (!record.executionId || !record.capability?.expiresAt
        || !Number.isFinite(Date.parse(record.capability.expiresAt))) throw new Error('Invalid capability');
      if (Date.parse(record.capability.expiresAt) <= now) expiredCapabilities++;
    } catch { invalidCapabilities++; }
  }
  rows.sort((a, b) => Number(b.needsReview) - Number(a.needsReview)
    || a.executionHash.localeCompare(b.executionHash) || a.operationId.localeCompare(b.operationId));
  return { approvals: { total, invalid, needsReview, byState, shown: Math.min(rows.length, 100),
    rows: rows.slice(0, 100) }, unsupported: { ...unsupported, invalid: unsupportedInvalid,
    shown: Math.min(unsupportedRows.length, 100), rows: unsupportedRows.slice(0, 100) },
    capabilities: { total: capabilityTotal, expired: expiredCapabilities,
      invalid: invalidCapabilities } };
}

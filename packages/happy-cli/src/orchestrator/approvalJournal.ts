import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireFileLock } from './fileLock';

export type ApprovalOperation = {
  decisionId: string; executionId: string; taskId: string; runId?: string; machineId: string;
  dispatchTokenHash: string; operationId: string; actionType: string; actionHash: string;
  childSessionId: string; worktreePathHash: string; branchName: string;
  requestVersion: number; expiresAt: string;
  state: 'requested' | 'approved' | 'rejected' | 'invoking' | 'invoked';
  decisionVersion: number | null;
  acceptedFinish?: boolean;
};
export type ApprovalDelivery = Pick<ApprovalOperation, 'decisionId' | 'executionId' | 'operationId'
  | 'actionType' | 'actionHash' | 'childSessionId' | 'worktreePathHash' | 'branchName' | 'expiresAt'> & {
  dispatchToken: string; version: number; decision: 'approved' | 'rejected';
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const file = (root: string, executionId: string, operationId: string) =>
  join(root, `${hash(`${executionId}\0${operationId}`)}.json`);

async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await acquireFileLock(join(root, '.queue.lock'), 30);
  try { return await action(); } finally { await lock.release(); }
}
async function write(root: string, operation: ApprovalOperation): Promise<void> {
  const temporary = join(root, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(operation), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file(root, operation.executionId, operation.operationId));
  } finally { await rm(temporary, { force: true }); }
}
async function read(root: string, executionId: string, operationId: string): Promise<ApprovalOperation | null> {
  try { return JSON.parse(await readFile(file(root, executionId, operationId), 'utf8')) as ApprovalOperation; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function requestApproval(root: string, operation: ApprovalOperation): Promise<void> {
  if (operation.state !== 'requested' || operation.decisionVersion !== null
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(operation.operationId)
    || !/^[a-z][a-z0-9._:-]{0,63}$/.test(operation.actionType)
    || !operation.childSessionId || operation.childSessionId.length > 256
    || !operation.branchName || operation.branchName.length > 256
    || !/^[0-9a-f]{64}$/.test(operation.actionHash)
    || !/^[0-9a-f]{64}$/.test(operation.worktreePathHash)
    || !/^[0-9a-f]{64}$/.test(operation.dispatchTokenHash)
    || !Number.isSafeInteger(operation.requestVersion) || operation.requestVersion < 0
    || !Number.isFinite(Date.parse(operation.expiresAt))
    || Date.parse(operation.expiresAt) <= Date.now()) throw new Error('Invalid approval operation');
  await locked(root, async () => {
    const prior = await read(root, operation.executionId, operation.operationId);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(operation)) throw new Error('Approval operation identity changed');
      return;
    }
    await write(root, operation);
  });
}
export async function deliverApproval(root: string, input: ApprovalDelivery,
  binding: { taskId: string; machineId: string; childSessionId: string;
    worktreePath: string; branchName: string }): Promise<boolean> {
  return locked(root, async () => {
    const row = await read(root, input.executionId, input.operationId);
    if (!row || row.decisionId !== input.decisionId || row.taskId !== binding.taskId
      || row.machineId !== binding.machineId || row.dispatchTokenHash !== hash(input.dispatchToken)
      || row.actionHash !== input.actionHash || row.actionType !== input.actionType
      || row.childSessionId !== input.childSessionId || row.childSessionId !== binding.childSessionId
      || row.worktreePathHash !== input.worktreePathHash
      || row.worktreePathHash !== hash(binding.worktreePath)
      || row.branchName !== input.branchName || row.branchName !== binding.branchName
      || row.expiresAt !== input.expiresAt
      || Date.parse(row.expiresAt) <= Date.now()
      || input.version !== row.requestVersion + 1) return false;
    const next = input.decision === 'approved' ? 'approved' : 'rejected';
    if (row.decisionVersion === input.version) return row.state === next
      || (next === 'approved' && (row.state === 'invoking' || row.state === 'invoked'));
    if (row.state !== 'requested' || row.decisionVersion !== null) return false;
    await write(root, { ...row, state: next, decisionVersion: input.version });
    return true;
  });
}
export async function transitionApproval(root: string, executionId: string, operationId: string,
  actionHash: string, from: 'approved' | 'invoking', to: 'invoking' | 'invoked'): Promise<boolean> {
  if (!((from === 'approved' && to === 'invoking') || (from === 'invoking' && to === 'invoked'))) return false;
  return locked(root, async () => {
    const row = await read(root, executionId, operationId);
    if (!row || row.actionHash !== actionHash || row.state !== from
      || (from === 'approved' && Date.parse(row.expiresAt) <= Date.now())) return false;
    await write(root, { ...row, state: to });
    return true;
  });
}
export async function readApproval(root: string, executionId: string, operationId: string): Promise<ApprovalOperation | null> {
  return locked(root, () => read(root, executionId, operationId));
}

export async function assertNoUnresolvedApprovals(root: string, taskId: string): Promise<void> {
  await locked(root, async () => {
    for (const entry of await readdir(root)) {
      if (!entry.endsWith('.json')) continue;
      const item = JSON.parse(await readFile(join(root, entry), 'utf8')) as ApprovalOperation;
      if (!item.taskId || !item.executionId || !item.operationId || !item.state)
        throw new Error('Approval journal contains an invalid record');
      if (item.taskId === taskId && item.state !== 'rejected' && !item.acceptedFinish)
        throw new Error('APPROVAL_RECOVERY_REQUIRED: prior operation outcome requires review');
    }
  });
}

export async function acknowledgeApprovalFinish(root: string, executionId: string): Promise<void> {
  await locked(root, async () => {
    for (const entry of await readdir(root)) {
      if (!entry.endsWith('.json')) continue;
      const item = JSON.parse(await readFile(join(root, entry), 'utf8')) as ApprovalOperation;
      if (item.executionId !== executionId || item.acceptedFinish) continue;
      if (item.state !== 'invoked') throw new Error('Approval operation is not durably invoked');
      await write(root, { ...item, acceptedFinish: true });
    }
  });
}

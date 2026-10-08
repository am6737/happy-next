import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import type { OrchestratorDispatchPayload } from './common';
import { readApproval, requestApproval, transitionApproval, type ApprovalDelivery } from './approvalJournal';

const actionSchema = z.object({ kind: z.literal('request'), childSessionId: z.string().min(8).max(256),
  operationId: z.string().regex(/^[0-9a-f]{64}$/), actionType: z.enum(['shell', 'file_change']),
  actionHash: z.string().regex(/^[0-9a-f]{64}$/), summary: z.string().min(1).max(2_000) }).strict();
const resultSchema = z.object({ kind: z.literal('result'), operationId: z.string().regex(/^[0-9a-f]{64}$/),
  actionHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startApprovalProxy(input: { api: ApiClient; payload: OrchestratorDispatchPayload;
  root: string; machineId: string; worktreePath: string; identityReady: (sessionId: string) => Promise<void>;
  active: () => boolean }): Promise<{ url: string; capability: string;
  delivered: (delivery: ApprovalDelivery) => void; close: () => Promise<void> }> {
  const capability = randomBytes(32).toString('hex');
  const waiters = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();
  let closed = false;
  const branch = () => execFileSync('git', ['branch', '--show-current'], {
    cwd: input.worktreePath, encoding: 'utf8', timeout: 10_000 }).trim();
  const server = createServer(async (request, response) => {
    const send = (status: number, approved = false) => {
      if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ approved }));
    };
    if (closed || request.method !== 'POST' || request.url !== '/approval'
      || request.headers.authorization !== `Bearer ${capability}`) { send(403); return; }
    let stage = 'parse';
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body, 'utf8') > 3_000) { send(413); return; }
      }
      const data = JSON.parse(body) as unknown;
      if (typeof data !== 'object' || data === null) { send(400); return; }
      if ((data as { kind?: unknown }).kind === 'result') {
        const result = resultSchema.parse(data);
        const row = await readApproval(input.root, input.payload.executionId, result.operationId);
        if (!row || row.actionHash !== result.actionHash || row.state !== 'invoking') { send(409); return; }
        send(await transitionApproval(input.root, input.payload.executionId, result.operationId,
          result.actionHash, 'invoking', 'invoked') ? 200 : 409);
        return;
      }
      if (!input.active()) { send(403); return; }
      const action = actionSchema.parse(data);
      stage = 'identity';
      await input.identityReady(action.childSessionId);
      if (!input.active()) { logger.warn('APPROVAL_PROXY_INACTIVE_AFTER_IDENTITY'); send(409); return; }
      const branchName = branch();
      if (!branchName) { logger.warn('APPROVAL_PROXY_BRANCH_MISSING'); send(409); return; }
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      stage = 'server_decision';
      const issued = await input.api.requestExecutionApproval({ executionId: input.payload.executionId,
        machineId: input.machineId, operationId: action.operationId, actionType: action.actionType,
        actionHash: action.actionHash, summary: action.summary, expiresAt });
      stage = 'journal';
      await requestApproval(input.root, { decisionId: issued.id,
        executionId: input.payload.executionId, taskId: input.payload.taskId,
        runId: input.payload.runId, machineId: input.machineId,
        dispatchTokenHash: hash(input.payload.dispatchToken), operationId: action.operationId,
        actionType: action.actionType, actionHash: action.actionHash,
        childSessionId: action.childSessionId, worktreePathHash: hash(input.worktreePath),
        branchName, requestVersion: issued.version, expiresAt: issued.expiresAt,
        state: 'requested', decisionVersion: null });
      if (waiters.has(action.operationId)) { send(409); return; }
      const approved = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { waiters.delete(action.operationId); resolve(false); },
          Math.max(0, Date.parse(issued.expiresAt) - Date.now()));
        waiters.set(action.operationId, { resolve, timer });
        void readApproval(input.root, input.payload.executionId, action.operationId).then((row) => {
          if (row?.state !== 'approved' && row?.state !== 'rejected') return;
          const waiter = waiters.get(action.operationId);
          if (!waiter) return;
          waiters.delete(action.operationId);
          clearTimeout(waiter.timer);
          waiter.resolve(row.state === 'approved');
        }).catch(() => {
          const waiter = waiters.get(action.operationId);
          if (waiter) { waiters.delete(action.operationId); clearTimeout(waiter.timer); waiter.resolve(false); }
        });
      });
      if (!approved || !input.active() || branch() !== branchName) {
        logger.warn(`APPROVAL_PROXY_NOT_RELEASED ${!approved ? 'NO_DECISION' : !input.active() ? 'INACTIVE' : 'BRANCH_CHANGED'}`);
        send(409); return;
      }
      const granted = await transitionApproval(input.root, input.payload.executionId,
        action.operationId, action.actionHash, 'approved', 'invoking');
      // The journal lock can wait across lease loss; invoking then remains uncertain.
      const releasable = granted && input.active() && branch() === branchName
        && Date.parse(issued.expiresAt) > Date.now() && !closed;
      send(releasable ? 200 : 409, releasable);
    } catch (error) {
      const status = (error as { response?: { status?: unknown } })?.response?.status;
      const known = error instanceof Error && [
        'Execution session identity changed', 'Execution identity binding failed',
        'Execution is no longer active', 'Execution identity was not bound in time',
      ].includes(error.message) ? error.message.replaceAll(' ', '_').toUpperCase() : 'LOCAL_ERROR';
      logger.warn(`APPROVAL_PROXY_FAILURE ${stage} ${typeof status === 'number' ? `HTTP_${status}` : known}`);
      send(409);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Approval proxy address unavailable');
  return { url: `http://127.0.0.1:${address.port}/approval`, capability,
    delivered: (delivery) => {
      const waiter = waiters.get(delivery.operationId);
      if (!waiter) return;
      waiters.delete(delivery.operationId);
      clearTimeout(waiter.timer);
      waiter.resolve(delivery.decision === 'approved');
    },
    close: () => {
      closed = true;
      for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.resolve(false); }
      waiters.clear();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    } };
}

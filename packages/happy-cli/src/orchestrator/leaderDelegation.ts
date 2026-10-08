import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ApiClient } from '@/api/api';
import type { OrchestratorDispatchPayload } from './common';

const requestSchema = z.object({
  delegationKey: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  assignedAgentId: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(256),
  requirements: z.string().trim().min(1).max(32_768),
  dependsOnTaskIds: z.array(z.string().min(1).max(256)).max(8).default([]),
}).strict();

export async function startLeaderDelegationProxy(api: ApiClient, payload: OrchestratorDispatchPayload): Promise<{
  url: string; capability: string; close: () => Promise<void>;
}> {
  if (!payload.teamId || !payload.assignedAgentId || payload.parentTaskId || payload.delegationDepth !== 0 || payload.integrationPolicy)
    throw new Error('Leader delegation is unavailable for this execution');
  const capability = randomBytes(32).toString('hex');
  const server: Server = createServer(async (request, response) => {
    const reject = (status: number) => { response.writeHead(status); response.end(); };
    if (request.method !== 'POST' || request.url !== '/delegate' || request.headers.authorization !== `Bearer ${capability}`) {
      reject(403); return;
    }
    let body = '';
    try {
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 36_000) { reject(413); return; }
      }
      const input = requestSchema.parse(JSON.parse(body));
      const result = await api.delegateAiTeamTask(payload.taskId,
        { ...input, dispatchToken: payload.dispatchToken }, payload.executionId);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch {
      reject(409);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Delegation proxy address is unavailable');
  return { url: `http://127.0.0.1:${address.port}/delegate`, capability,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

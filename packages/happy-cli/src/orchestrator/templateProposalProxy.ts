import { createServer, type Server } from 'node:http';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AiAgentTemplateContentSchema } from 'happy-wire';
import type { ApiClient } from '@/api/api';
import type { OrchestratorDispatchPayload } from './common';

const proposalSchema = z.object({
  clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  content: AiAgentTemplateContentSchema,
  note: z.string().trim().min(1).max(4000),
}).strict();

const SOCKET_PATH_LIMIT = 100;
const SHORT_SOCKET_ROOT = '/tmp';

function assertSocketParent(path: string, shared: boolean): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path))
    throw new Error('Template proposal socket parent is not a real directory');
  if (shared) {
    if (stat.uid !== 0 || (stat.mode & 0o1000) === 0)
      throw new Error('Template proposal shared socket parent is unsafe');
  } else if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error('Template proposal private socket parent is unsafe');
  }
}

function createSocketDirectory(privateRoot: string): { directory: string; socketPath: string } {
  const useShortRoot = Buffer.byteLength(join(privateRoot, 'tp-XXXXXX', 'rpc.sock')) >= SOCKET_PATH_LIMIT;
  if (!useShortRoot) mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const base = useShortRoot ? SHORT_SOCKET_ROOT : privateRoot;
  assertSocketParent(base, useShortRoot);
  const directory = mkdtempSync(join(base, 'tp-'));
  try {
    const stat = lstatSync(directory);
    if (stat.uid !== process.getuid?.() || !stat.isDirectory() || (stat.mode & 0o077) !== 0)
      throw new Error('Template proposal socket directory is unsafe');
    const socketPath = join(directory, 'rpc.sock');
    if (Buffer.byteLength(socketPath) >= SOCKET_PATH_LIMIT)
      throw new Error('Template proposal socket path is too long');
    return { directory, socketPath };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function startTemplateProposalProxy(input: { api: ApiClient;
  payload: OrchestratorDispatchPayload; machineId: string; privateRoot: string }):
  Promise<{ socketPath: string; frozenContent: { role: string; description: string;
    emoji: string; skills: string[]; responsibilities: string[]; instructions: string };
    close: () => Promise<void> }> {
  const { payload } = input;
  if (payload.provider !== 'codex'
    || !payload.executionCapability?.allowedOps.includes('template_propose')
    || payload.executionCapability.recoveryMode === 'drain'
    || Date.parse(payload.executionCapability.expiresAt) <= Date.now())
    throw new Error('Frozen template proposal scope unavailable');
  const context = await input.api.getExecutionTemplateProposalContext({
    executionId: payload.executionId, machineId: input.machineId,
    dispatchToken: payload.dispatchToken });
  if (payload.templateProposalScope && (payload.templateProposalScope.templateId !== context.templateId
    || payload.templateProposalScope.expectedCurrentVersion !== context.currentVersion))
    throw new Error('Frozen template proposal dispatch identity changed');
  const { directory, socketPath } = createSocketDirectory(input.privateRoot);
  let closed = false;
  const server: Server = createServer(async (request, response) => {
    const send = (status: number, value?: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(value ? JSON.stringify(value) : '{}');
    };
    if (closed || request.method !== 'POST' || request.url !== '/propose') {
      send(403); return;
    }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body, 'utf8') > 80_000) { send(413); return; }
      }
      const parsed = proposalSchema.parse(JSON.parse(body));
      const result = await input.api.proposeExecutionTemplate({
        executionId: payload.executionId, machineId: input.machineId,
        dispatchToken: payload.dispatchToken,
        templateId: context.templateId,
        expectedCurrentVersion: context.currentVersion,
        ...parsed,
      });
      send(200, result);
    } catch (error) {
      const status = (error as { response?: { status?: unknown } })?.response?.status;
      if (status === 409) send(409, { errorCode: 'TEMPLATE_SCOPE_OR_VERSION_CHANGED' });
      else if ((typeof status === 'number' && status >= 500)
        || (status === undefined && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)))
        send(503, { errorCode: 'TEMPLATE_SERVER_UNAVAILABLE' });
      else send(409, { errorCode: 'TEMPLATE_PROPOSAL_INPUT_INVALID' });
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o600);
    const socketStat = lstatSync(socketPath);
    if (!socketStat.isSocket() || socketStat.uid !== process.getuid?.()
      || (socketStat.mode & 0o077) !== 0)
      throw new Error('Template proposal socket permissions are unsafe');
  } catch (error) {
    server.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return { socketPath, frozenContent: context.frozenContent, close: () => {
    closed = true;
    return new Promise<void>((resolve) => server.close(() => {
      rmSync(directory, { recursive: true, force: true });
      resolve();
    }));
  } };
}

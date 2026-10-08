import { request } from 'node:http';
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startTemplateProposalProxy } from './templateProposalProxy';

const content = { role: 'Reviewer', description: 'Review changes', emoji: '', skills: [],
  responsibilities: [], instructions: 'Check tests' };

function post(socketPath: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/propose', method: 'POST',
      headers: { 'content-type': 'application/json' } }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk.toString(); });
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('execution template proposal proxy', () => {
  it('uses only the server-bound template and never accepts a model-selected identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-proxy-test-'));
    const api = {
      getExecutionTemplateProposalContext: vi.fn().mockResolvedValue({ templateId: 'fixed-template',
        sourceExecutionId: 'execution-1', frozenVersion: 1, currentVersion: 2, frozenContent: content }),
      proposeExecutionTemplate: vi.fn().mockResolvedValue({ id: 'proposal-1', status: 'pending', duplicate: false }),
    };
    const payload = { provider: 'codex', executionId: 'execution-1', dispatchToken: 'dispatch-1',
      executionCapability: { protocolVersion: 1, allowedOps: ['template_propose'],
        expiresAt: new Date(Date.now() + 60_000).toISOString() } } as any;
    try {
      const proxy = await startTemplateProposalProxy({ api: api as any, payload, machineId: 'machine-1', privateRoot: root });
      try {
        const ok = await post(proxy.socketPath, { clientRequestId: 'request-1', content, note: 'Improve review' });
        expect(ok.status).toBe(200);
        expect(api.proposeExecutionTemplate).toHaveBeenCalledWith(expect.objectContaining({
          executionId: 'execution-1', templateId: 'fixed-template', expectedCurrentVersion: 2,
          machineId: 'machine-1', dispatchToken: 'dispatch-1' }));
        const bad = await post(proxy.socketPath, { clientRequestId: 'request-2', content,
          note: 'Improve review', templateId: 'other-template' });
        expect(bad.status).toBe(409);
        expect(api.proposeExecutionTemplate).toHaveBeenCalledTimes(1);
      } finally { await proxy.close(); }
      await expect(startTemplateProposalProxy({ api: api as any, payload: {
        ...payload, executionCapability: { ...payload.executionCapability, recoveryMode: 'drain' },
      }, machineId: 'machine-1', privateRoot: root })).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('serves concurrent long-home executions from isolated short sockets and removes them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-long-home-'));
    const privateRoot = join(root, 'a'.repeat(65), 'b'.repeat(65), 'orchestrator-template-proxies');
    const api = {
      getExecutionTemplateProposalContext: vi.fn().mockResolvedValue({ templateId: 'fixed-template',
        sourceExecutionId: 'execution-1', frozenVersion: 1, currentVersion: 1, frozenContent: content }),
      proposeExecutionTemplate: vi.fn().mockResolvedValue({ id: 'pending', status: 'pending', duplicate: false }),
    };
    const payload = { provider: 'codex', executionId: 'execution-1', dispatchToken: 'dispatch-1',
      executionCapability: { protocolVersion: 1, allowedOps: ['template_propose'],
        expiresAt: new Date(Date.now() + 60_000).toISOString() } } as any;
    const proxies = await Promise.all([1, 2].map(() => startTemplateProposalProxy({
      api: api as any, payload, machineId: 'machine-1', privateRoot,
    })));
    try {
      expect(proxies[0].socketPath).not.toBe(proxies[1].socketPath);
      for (const proxy of proxies) {
        expect(Buffer.byteLength(proxy.socketPath)).toBeLessThan(100);
        expect(lstatSync(join(proxy.socketPath, '..')).mode & 0o077).toBe(0);
        expect(lstatSync(proxy.socketPath).mode & 0o077).toBe(0);
        expect((await post(proxy.socketPath, { clientRequestId: 'request-1', content,
          note: 'Improve review' })).status).toBe(200);
      }
    } finally {
      await Promise.all(proxies.map((proxy) => proxy.close()));
      for (const proxy of proxies) expect(existsSync(proxy.socketPath)).toBe(false);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked private socket parent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-parent-test-'));
    const link = join(root, 'linked');
    symlinkSync(root, link, 'dir');
    const api = { getExecutionTemplateProposalContext: vi.fn().mockResolvedValue({
      templateId: 'fixed-template', sourceExecutionId: 'execution-1', frozenVersion: 1,
      currentVersion: 1, frozenContent: content }) };
    const payload = { provider: 'codex', executionId: 'execution-1', dispatchToken: 'dispatch-1',
      executionCapability: { protocolVersion: 1, allowedOps: ['template_propose'],
        expiresAt: new Date(Date.now() + 60_000).toISOString() } } as any;
    try {
      await expect(startTemplateProposalProxy({ api: api as any, payload,
        machineId: 'machine-1', privateRoot: link })).rejects.toThrow('not a real directory');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

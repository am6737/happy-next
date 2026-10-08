import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ApiClient } from '@/api/api';
import { loadExecutionCapability, saveExecutionCapability } from './executionCapability';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({ default: { post } }));

it('waits for owner confirmation then drains expired execution as failed without model output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-capability-recovery-'));
  const old = { token: 'a'.repeat(64), protocolVersion: 1 as const,
    allowedOps: ['finish', 'event', 'usage', 'decision_request'],
    expiresAt: new Date(Date.now() - 60_000).toISOString() };
  const drain = { token: 'b'.repeat(64), protocolVersion: 1 as const,
    recoveryMode: 'drain' as const, allowedOps: ['finish', 'event', 'usage'],
    expiresAt: new Date(Date.now() + 600_000).toISOString() };
  let confirmed = false;
  let revoked = false;
  let finishOffline = true;
  post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith('/recovery-requests')) {
      if (revoked) throw Object.assign(new Error('recovery rejected'), { response: { status: 409 } });
      expect(body).toMatchObject({ machineId: 'machine', dispatchToken: 'dispatch',
        expiredCapability: old.token });
      return { data: { id: 'recovery', generation: 1, status: confirmed ? 'confirmed' : 'pending',
        expiresAt: new Date(Date.now() + 600_000).toISOString() } };
    }
    if (url.endsWith('/claim')) return { data: { ...drain, generation: 1 } };
    if (url.endsWith('/finish')) {
      if (finishOffline) throw new Error('finish offline');
      return { data: { ok: true } };
    }
    throw new Error('Unexpected recovery endpoint');
  });
  try {
    await saveExecutionCapability(root, 'execution', 'dispatch', old);
    const api = await ApiClient.create({ token: 'private-account-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32) } });
    api.setExecutionCapabilityRoot(root);
    api.setExecutionCapabilityMachine('machine');
    const finish = { executionId: 'execution', dispatchToken: 'dispatch',
      status: 'completed' as const, finishedAt: new Date().toISOString(), exitCode: 0,
      finalResponse: 'private-model-output', commitSha: 'c'.repeat(40) };
    await expect(api.reportOrchestratorExecutionFinish(finish)).rejects.toThrow('RECOVERY_PENDING');
    expect(post.mock.calls.some(([url]) => String(url).endsWith('/finish'))).toBe(false);
    revoked = true;
    await expect(api.reportOrchestratorExecutionFinish(finish)).rejects.toThrow('recovery rejected');
    expect(post.mock.calls.some(([url]) => String(url).endsWith('/finish'))).toBe(false);
    expect((await loadExecutionCapability(root, 'execution'))?.capability.token).toBe(old.token);
    revoked = false;
    confirmed = true;
    await expect(api.reportOrchestratorExecutionFinish(finish)).rejects.toThrow('finish offline');
    expect((await loadExecutionCapability(root, 'execution'))?.capability).toEqual(drain);
    expect(await loadExecutionCapability(root, 'execution')).toMatchObject({
      originalCapability: old, recoveryId: 'recovery', recoveryGeneration: 1 });
    finishOffline = false;
    await api.reportOrchestratorExecutionFinish(finish);
    const sent = post.mock.calls.find(([url]) => String(url).endsWith('/finish'))?.[1];
    expect(sent).toMatchObject({ status: 'failed', errorCode: 'EXECUTION_CAPABILITY_EXPIRED',
      exitCode: 1, capability: drain.token, finalResponse: null, commitSha: null });
    expect(JSON.stringify(sent)).not.toContain('private-model-output');
    expect((await loadExecutionCapability(root, 'execution'))?.capability).toEqual(drain);
    expect(post.mock.calls.filter(([url]) => String(url).endsWith('/claim'))).toHaveLength(1);
    expect(post.mock.calls.filter(([url]) => String(url).endsWith('/finish'))).toHaveLength(2);
  } finally { rmSync(root, { recursive: true, force: true }); post.mockReset(); }
});

import { describe, expect, it, vi } from 'vitest';
import { startLeaderDelegationProxy } from './leaderDelegation';
import type { ApiClient } from '@/api/api';

describe('execution-scoped leader delegation proxy', () => {
  it('forwards only bounded calls with the daemon-held execution token', async () => {
    const delegateAiTeamTask = vi.fn().mockResolvedValue({ taskId: 'child', runId: 'run', duplicate: false });
    const proxy = await startLeaderDelegationProxy({ delegateAiTeamTask } as unknown as ApiClient, {
      executionId: 'execution', runId: 'run', taskId: 'leader', dispatchToken: 'trusted-token',
      provider: 'codex', executionType: 'initial', prompt: 'plan', timeoutMs: 1000,
      teamId: 'team', assignedAgentId: 'agent', delegationDepth: 0,
    });
    try {
      const body = { delegationKey: 'alpha', assignedAgentId: 'member', title: 'Alpha', requirements: 'Make alpha.txt' };
      const send = (authorization: string, value: unknown) => fetch(proxy.url, { method: 'POST', headers: {
        authorization, 'content-type': 'application/json',
      }, body: JSON.stringify(value) });
      expect((await send('Bearer wrong', body)).status).toBe(403);
      expect((await send(`Bearer ${proxy.capability}`, { ...body, dispatchToken: 'forged' })).status).toBe(409);
      expect((await send(`Bearer ${proxy.capability}`, body)).status).toBe(200);
      expect(delegateAiTeamTask).toHaveBeenCalledOnce();
      expect(delegateAiTeamTask).toHaveBeenCalledWith('leader', { ...body, dependsOnTaskIds: [], dispatchToken: 'trusted-token' });
    } finally { await proxy.close(); }
  });
});

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/api/api';
import { enqueueEvent } from './eventQueue';
import { enqueueUsage } from './usageQueue';
import { enqueueFinish } from './finishQueue';
import { flushTelemetryAndFinishes } from './flushTelemetry';
import { allowLegacyTelemetryExecution, saveLegacyTelemetryBinding, unsupportedTelemetryRoute } from './telemetryCompatibility';
import type { OrchestratorDispatchPayload } from './common';

const executionId = 'execution-123';
const route404 = (route: 'capabilities' | 'events' | 'usage-deltas', status = 404,
  message = `Route POST:/v1/ai-team/executions/${executionId}/${route} not found`) => ({
  response: { status, data: { statusCode: status, error: 'Not Found', message } },
  config: { url: `http://127.0.0.1:3067/v1/ai-team/executions/${executionId}/${route}`, method: 'post' },
});
const firstPreflight404 = () => ({ ...route404('capabilities'), telemetryPreflightOperation: 'event' });
const record = async (root: string, status: 'completed' | 'cancelled' | 'timeout' = 'completed') => {
  await enqueueEvent(join(root, 'events'), { eventId: `${executionId}:1`, executionId,
    machineId: 'machine', seq: 1, kind: 'status', phase: 'finished',
    occurredAt: '2026-10-07T00:00:00.000Z', summary: 'Execution completed' });
  await enqueueUsage(join(root, 'usage'), { executionId, machineId: 'machine', sourceEventId: 'turn-1',
    provider: 'codex', model: 'test', inputTokens: 3, outputTokens: 2,
    costMicros: null, pricingVersion: null, measuredAt: '2026-10-07T00:00:00.000Z' });
  await enqueueFinish(root, { executionId, dispatchToken: 'owner-token', status,
    finishedAt: '2026-10-07T00:00:00.000Z', outputText: 'private result', finalResponse: 'private result' });
};

describe('telemetry compatibility recovery', () => {
  it('recognizes only the exact missing telemetry route', () => {
    const oldCustom = { response: { status: 404, data: {
      error: 'Not found', path: `/v1/ai-team/executions/${executionId}/capabilities`, method: 'POST',
    } }, config: { url: `http://127.0.0.1:3067/v1/ai-team/executions/${executionId}/capabilities`, method: 'post' },
      telemetryPreflightOperation: 'event' };
    expect(allowLegacyTelemetryExecution({ executionId, runId: 'run', taskId: 'task',
      dispatchToken: 'token', provider: 'codex', executionType: 'initial', prompt: '', timeoutMs: 1000 },
    oldCustom)).toBe(true);
    expect(allowLegacyTelemetryExecution({ executionId, runId: 'run', taskId: 'task',
      dispatchToken: 'token', provider: 'codex', executionType: 'initial', prompt: '', timeoutMs: 1000,
      internalAi: true }, oldCustom)).toBe(false);
    expect(unsupportedTelemetryRoute({ ...oldCustom,
      config: { ...oldCustom.config, url: `${oldCustom.config.url}?x=1` } }, executionId, 'event')).toBe(false);
    expect(unsupportedTelemetryRoute({ ...oldCustom,
      response: { status: 404, data: { ...oldCustom.response.data, path: '/wrong' } } }, executionId, 'event')).toBe(false);
    expect(unsupportedTelemetryRoute(route404('capabilities'), executionId, 'event')).toBe(true);
    expect(unsupportedTelemetryRoute(route404('events'), executionId, 'event')).toBe(true);
    expect(unsupportedTelemetryRoute(route404('usage-deltas'), executionId, 'usage')).toBe(true);
    expect(unsupportedTelemetryRoute(route404('capabilities', 409), executionId, 'event')).toBe(false);
    expect(unsupportedTelemetryRoute(route404('events', 404, 'Execution not found'), executionId, 'event')).toBe(false);
    expect(unsupportedTelemetryRoute(route404('events'), 'another-execution', 'event')).toBe(false);
    expect(unsupportedTelemetryRoute({ response: { status: 404 } }, executionId, 'event')).toBe(false);
  });

  it('allows only an identity-free legacy task after exact missing capability route', () => {
    const plain = { executionId, runId: 'run-1', taskId: 'task-1', dispatchToken: 'token',
      provider: 'codex', executionType: 'initial', prompt: 'test', timeoutMs: 30_000 } as OrchestratorDispatchPayload;
    expect(allowLegacyTelemetryExecution(plain, firstPreflight404())).toBe(true);
    for (const marker of [{ assignedAgentId: 'agent' }, { teamId: 'team' },
      { parentTaskId: 'parent' }, { projectId: 'project' }, { integrationPolicy: 'review_and_cherry_pick' },
      { templateProposalScope: { templateId: 'template', templateVersionId: 'version', expectedCurrentVersion: 1 } },
      { executionCapability: { protocolVersion: 1, allowedOps: [] } }]) {
      expect(allowLegacyTelemetryExecution({ ...plain, ...marker } as OrchestratorDispatchPayload,
        firstPreflight404())).toBe(false);
    }
    for (const error of [route404('capabilities'), route404('events'), route404('capabilities', 401),
      route404('capabilities', 403), route404('capabilities', 409),
      route404('capabilities', 503), route404('capabilities', 404, 'Execution not found'),
      new Error('network unavailable')])
      expect(allowLegacyTelemetryExecution(plain, error)).toBe(false);
    expect(allowLegacyTelemetryExecution(plain, {
      ...route404('capabilities'), telemetryPreflightOperation: 'usage',
    })).toBe(false);
    for (const status of [401, 403, 409, 503])
      expect(allowLegacyTelemetryExecution(plain, {
        ...route404('capabilities', status), telemetryPreflightOperation: 'event',
      })).toBe(false);
  });

  it('archives old-server records and durably reports failed finish after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-telemetry-legacy-'));
    try {
      await record(root);
      const failed = vi.fn(async () => { throw route404('capabilities'); });
      const finishes: Array<{ status: string; errorCode?: string | null; outputText?: string | null }> = [];
      const api: Pick<ApiClient, 'reportExecutionEvent' | 'reportUsageDelta' | 'reportOrchestratorExecutionFinish'> = {
        reportExecutionEvent: failed, reportUsageDelta: failed,
        reportOrchestratorExecutionFinish: async (report) => { finishes.push(report); throw new Error('offline'); },
      };
      await flushTelemetryAndFinishes(root, api);
      expect(finishes).toMatchObject([{ status: 'failed', errorCode: 'TELEMETRY_ENDPOINT_UNSUPPORTED' }]);
      expect(finishes[0].outputText).toBeUndefined();
      expect(readdirSync(join(root, 'events', 'unsupported')).filter((file) => file.endsWith('.json'))).toHaveLength(1);
      expect(readdirSync(join(root, 'usage', 'unsupported')).filter((file) => file.endsWith('.json'))).toHaveLength(1);
      const recovered: typeof finishes = [];
      await flushTelemetryAndFinishes(root, { ...api,
        reportOrchestratorExecutionFinish: async (report) => { recovered.push(report); } });
      expect(recovered).toEqual(finishes);
      expect(readdirSync(root).filter((file) => file.endsWith('.json'))).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('preserves exact legacy finish status only after bound audit is durably archived', async () => {
    for (const status of ['completed', 'cancelled', 'timeout'] as const) {
      const root = mkdtempSync(join(tmpdir(), 'happy-legacy-bound-'));
      try {
        await record(root, status);
        await saveLegacyTelemetryBinding(root, { executionId, runId: 'run', taskId: 'task',
          dispatchToken: 'owner-token', provider: 'codex', executionType: 'initial',
          prompt: 'test', timeoutMs: 30_000 }, 'machine');
        const finish = vi.fn(async () => {});
        await flushTelemetryAndFinishes(root, { reportExecutionEvent: async () => { throw route404('capabilities'); },
          reportUsageDelta: async () => { throw route404('capabilities'); },
          reportOrchestratorExecutionFinish: finish });
        expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status,
          dispatchToken: 'owner-token', outputText: 'private result' }));
        const archived = readdirSync(join(root, 'events', 'unsupported')).find((file) => file.endsWith('.json'))!;
        const metadata = JSON.parse(readFileSync(join(root, 'events', 'unsupported', `${archived}.reason`), 'utf8'));
        expect(metadata).toMatchObject({ reason: 'TELEMETRY_ENDPOINT_UNSUPPORTED', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  it('retains finish when bound legacy audit is corrupt or belongs to another owner', async () => {
    for (const wrongOwner of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), 'happy-legacy-corrupt-'));
      try {
        await record(root);
        await saveLegacyTelemetryBinding(root, { executionId, runId: 'run', taskId: 'task',
          dispatchToken: wrongOwner ? 'other-owner' : 'owner-token', provider: 'codex',
          executionType: 'initial', prompt: 'test', timeoutMs: 30_000 }, 'machine');
        const finish = vi.fn(async () => {});
        await flushTelemetryAndFinishes(root, { reportExecutionEvent: async () => { throw route404('capabilities'); },
          reportUsageDelta: async () => { throw route404('capabilities'); },
          reportOrchestratorExecutionFinish: async () => { throw new Error('offline'); } });
        if (!wrongOwner) {
          const archived = readdirSync(join(root, 'events', 'unsupported')).find((file) => file.endsWith('.json'))!;
          writeFileSync(join(root, 'events', 'unsupported', archived), '{"tampered":true}');
        }
        await flushTelemetryAndFinishes(root, { reportExecutionEvent: async () => {},
          reportUsageDelta: async () => {}, reportOrchestratorExecutionFinish: finish });
        expect(finish).not.toHaveBeenCalled();
        expect(readdirSync(root).filter((file) => file.endsWith('.json'))).toHaveLength(1);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  it('keeps revoked and unrelated errors pending without sending finish', async () => {
    for (const error of [route404('capabilities', 401), route404('capabilities', 403),
      route404('capabilities', 409), route404('capabilities', 503),
      route404('capabilities', 404, 'Execution not found'), new Error('network offline')]) {
      const root = mkdtempSync(join(tmpdir(), 'happy-telemetry-denied-'));
      try {
        await record(root);
        const finish = vi.fn(async () => {});
        await flushTelemetryAndFinishes(root, { reportExecutionEvent: async () => { throw error; },
          reportUsageDelta: async () => { throw error; }, reportOrchestratorExecutionFinish: finish });
        expect(finish).not.toHaveBeenCalled();
        expect(readdirSync(join(root, 'events')).filter((file) => file.endsWith('.json'))).toHaveLength(1);
        expect(readdirSync(join(root, 'usage')).filter((file) => file.endsWith('.json'))).toHaveLength(1);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { enqueueUsage, flushUsage, type UsageDelta } from './usageQueue';

it('keeps exact usage identity across failure and ACK without inventing a price', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-usage-queue-'));
  const item: UsageDelta = { executionId: 'execution', machineId: 'machine',
    sourceEventId: 'execution:codex:1', provider: 'codex', model: 'default',
    inputTokens: 25, outputTokens: 7, costMicros: null, pricingVersion: null,
    measuredAt: '2026-10-07T00:00:00.000Z' };
  try {
    await enqueueUsage(root, item);
    await expect(enqueueUsage(root, { ...item, inputTokens: 26 })).rejects.toThrow(/identity changed/);
    expect((await flushUsage(root, async () => { throw new Error('offline'); })).size).toBe(1);
    const sent: UsageDelta[] = [];
    expect(await flushUsage(root, async (value) => { sent.push(value); })).toEqual(new Set());
    expect(sent).toEqual([item]);
    expect(await flushUsage(root, async () => { throw new Error('duplicate send'); })).toEqual(new Set());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

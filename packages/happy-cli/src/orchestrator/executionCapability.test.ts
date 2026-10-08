import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadExecutionCapability, saveExecutionCapability } from './executionCapability';

it('persists one execution owner across restarts and rejects a changed dispatch owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-execution-capability-'));
  const capability = { token: 'a'.repeat(64), protocolVersion: 1 as const,
    allowedOps: ['identity', 'finish', 'decision_request'],
    expiresAt: new Date(Date.now() + 600_000).toISOString() };
  try {
    await saveExecutionCapability(root, 'execution-1', 'dispatch-1', capability);
    expect(await loadExecutionCapability(root, 'execution-1')).toEqual({
      dispatchToken: 'dispatch-1', capability });
    await expect(saveExecutionCapability(root, 'execution-1', 'other-dispatch', capability))
      .rejects.toThrow('owner changed');
    const renewed = { ...capability, token: 'b'.repeat(64),
      expiresAt: new Date(Date.parse(capability.expiresAt) + 600_000).toISOString() };
    await saveExecutionCapability(root, 'execution-1', 'dispatch-1', renewed);
    expect((await loadExecutionCapability(root, 'execution-1'))?.capability.token).toBe(renewed.token);
    await expect(saveExecutionCapability(root, 'execution-1', 'dispatch-1', {
      ...capability, token: 'c'.repeat(64) })).rejects.toThrow('expiry backwards');
    await expect(saveExecutionCapability(root, 'execution-1', 'dispatch-1', {
      ...renewed, token: 'd'.repeat(64), allowedOps: ['finish'] })).rejects.toThrow('changed scope');
    const drain = { token: 'e'.repeat(64), protocolVersion: 1 as const,
      recoveryMode: 'drain' as const, allowedOps: ['finish', 'event', 'usage'],
      expiresAt: new Date(Date.parse(renewed.expiresAt) + 600_000).toISOString() };
    await expect(saveExecutionCapability(root, 'execution-1', 'dispatch-1', drain, true, 'recovery-1234', 1))
      .rejects.toThrow('drain owner changed');
    expect((await loadExecutionCapability(root, 'execution-1'))?.capability.token).toBe(renewed.token);
    expect(await loadExecutionCapability(root, 'execution-2')).toBeNull();
    await expect(saveExecutionCapability(root, 'execution-3', 'dispatch-3', {
      ...capability, token: 'invalid' })).rejects.toThrow('Invalid execution capability');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('retains the original expired proof and recovery identity after drain across a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-execution-drain-'));
  try {
    const original = { token: 'a'.repeat(64), protocolVersion: 1 as const,
      allowedOps: ['finish', 'event', 'usage'], expiresAt: new Date(Date.now() - 1000).toISOString() };
    const drain = { token: 'b'.repeat(64), protocolVersion: 1 as const,
      recoveryMode: 'drain' as const, allowedOps: ['finish', 'event', 'usage'],
      expiresAt: new Date(Date.now() + 600_000).toISOString() };
    await saveExecutionCapability(root, 'execution-1', 'dispatch-1', original);
    await saveExecutionCapability(root, 'execution-1', 'dispatch-1', drain, true, 'recovery-1234', 1);
    expect(await loadExecutionCapability(root, 'execution-1')).toEqual({
      dispatchToken: 'dispatch-1', capability: drain,
      originalCapability: original, recoveryId: 'recovery-1234', recoveryGeneration: 1 });
    await expect(saveExecutionCapability(root, 'execution-1', 'dispatch-1', original))
      .rejects.toThrow('expiry backwards');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

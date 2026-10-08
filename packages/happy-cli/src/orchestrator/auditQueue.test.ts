import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectOrchestratorAudit } from './auditQueue';

it('shows fixed approval identities and archive size without private record fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-audit-'));
  try {
    mkdirSync(join(root, 'approvals'));
    mkdirSync(join(root, 'events', 'unsupported'), { recursive: true });
    mkdirSync(join(root, 'capabilities'));
    const row = { executionId: 'execution-private', operationId: 'a'.repeat(64),
      actionHash: 'b'.repeat(64), state: 'invoking', expiresAt: '2020-01-01T00:00:00.000Z',
      acceptedFinish: false, dispatchToken: 'private-token', command: 'private-command' };
    writeFileSync(join(root, 'approvals', 'one.json'), JSON.stringify(row));
    writeFileSync(join(root, 'approvals', 'bad.json'), '{');
    writeFileSync(join(root, 'events', 'unsupported', 'one.json'), '{}');
    writeFileSync(join(root, 'events', 'unsupported', 'one.json.reason'),
      'TELEMETRY_ENDPOINT_UNSUPPORTED\n');
    writeFileSync(join(root, 'capabilities', 'one.json'), JSON.stringify({
      executionId: 'private-execution', dispatchToken: 'private-token',
      capability: { token: 'private-capability', expiresAt: '2020-01-01T00:00:00.000Z' } }));
    const result = await inspectOrchestratorAudit(root, Date.parse('2021-01-01'));
    expect(result.approvals).toMatchObject({ total: 2, invalid: 1, shown: 1,
      needsReview: 1, byState: { invoking: 1 } });
    expect(result.approvals.rows[0]).toMatchObject({ operationId: row.operationId,
      actionHash: row.actionHash, state: 'invoking', expired: true,
      acceptedFinish: false, needsReview: true });
    expect(result.unsupported.records).toBe(1);
    expect(result.unsupported).toMatchObject({ invalid: 0, shown: 1,
      rows: [{ queue: 'event', reason: 'TELEMETRY_ENDPOINT_UNSUPPORTED', bytes: 2 }] });
    expect(result.capabilities).toEqual({ total: 1, expired: 1, invalid: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-command|private-capability|execution-private|happy-audit-/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

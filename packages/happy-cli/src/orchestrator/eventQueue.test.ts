import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { appendExecutionEvent, enqueueEvent, eventIdentityHash, flushEvents, type ExecutionEvent } from './eventQueue';

it('keeps failed events durable while later executions ACK and duplicate sends are idempotent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-event-queue-'));
  const event = (executionId: string): ExecutionEvent => ({ eventId: `${executionId}:finish`, executionId,
    machineId: 'machine', seq: 1, kind: 'status', phase: 'finished',
    occurredAt: '2026-10-07T00:00:00.000Z', summary: 'Execution completed' });
  try {
    await enqueueEvent(root, event('first'));
    await enqueueEvent(root, event('second'));
    await enqueueEvent(root, event('first'));
    const sent: string[] = [];
    const pending = await flushEvents(root, async (item) => {
      if (item.executionId === 'first') throw new Error('offline');
      sent.push(item.executionId);
    });
    expect(pending).toEqual(new Set([eventIdentityHash('first')]));
    expect(sent).toEqual(['second']);
    const recovered: string[] = [];
    expect(await flushEvents(root, async (item) => { recovered.push(item.executionId); })).toEqual(new Set());
    expect(recovered).toEqual(['first']);
    expect(await flushEvents(root, async () => { throw new Error('already ACKed'); })).toEqual(new Set());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('allocates durable sequence numbers across concurrent writers and ACK failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-event-sequence-'));
  try {
    const input = { executionId: 'execution', machineId: 'machine', kind: 'tool' as const,
      phase: 'started', occurredAt: '2026-10-07T00:00:00.000Z', summary: 'shell started' };
    const events = await Promise.all(Array.from({ length: 8 }, () => appendExecutionEvent(root, input)));
    expect(events.map((event) => event.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await flushEvents(root, async () => { throw new Error('offline'); }))
      .toEqual(new Set([eventIdentityHash('execution')]));
    const delivered: number[] = [];
    expect(await flushEvents(root, async (event) => { delivered.push(event.seq); })).toEqual(new Set());
    expect(delivered).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await appendExecutionEvent(root, input)).seq).toBe(9);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('recovers an ACK-pending event after its writer is SIGKILLed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-event-kill-'));
  const moduleUrl = new URL('./eventQueue.ts', import.meta.url).href;
  const source = `import { appendExecutionEvent } from ${JSON.stringify(moduleUrl)};
await appendExecutionEvent(process.argv[1], { executionId: 'killed', machineId: 'machine', kind: 'tool',
  phase: 'started', occurredAt: '2026-10-07T00:00:00.000Z', summary: 'shell started' });
process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, root],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Writer did not persist event')), 10_000);
      child.stdout.once('data', (chunk) => {
        clearTimeout(timer);
        if (chunk.toString().includes('READY')) resolve();
        else reject(new Error('Writer readiness invalid'));
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Writer exited ${code}`)); });
    });
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const recovered: ExecutionEvent[] = [];
    expect(await flushEvents(root, async (event) => { recovered.push(event); })).toEqual(new Set());
    expect(recovered.map(({ eventId, seq }) => ({ eventId, seq })))
      .toEqual([{ eventId: 'killed:1', seq: 1 }]);
    expect((await appendExecutionEvent(root, { executionId: 'killed', machineId: 'machine', kind: 'result',
      phase: 'completed', occurredAt: '2026-10-07T00:00:01.000Z', summary: 'shell completed success' })).seq).toBe(2);
  } finally { child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
});

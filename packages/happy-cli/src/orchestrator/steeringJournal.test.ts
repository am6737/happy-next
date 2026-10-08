import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSteering, steeringReplay, unfinishedSteering, writeSteering } from './steeringJournal';

describe('steering journal', () => {
  it('retains injection state through a new reader and isolates execution and token', () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-steering-journal-'));
    try {
      const record = { steeringId: 's1', executionId: 'e1', dispatchToken: 't1', taskId: 'task', runId: 'run',
        state: 'injecting' as const };
      writeSteering(root, record);
      expect(readSteering(root, 'e1')).toEqual(record);
      expect(readSteering(root, 'e2')).toBeNull();
      expect(steeringReplay(root, record)).toBe('reject');
      expect(unfinishedSteering(root)).toEqual([record]);
      writeSteering(root, { ...record, state: 'injected' });
      expect(unfinishedSteering(root)[0].state).toBe('injected');
      expect(steeringReplay(root, record)).toBe('ack');
      expect(steeringReplay(root, { ...record, dispatchToken: 'different' })).toBe('reject');
      expect(steeringReplay(root, { ...record, executionId: 'e2' })).toBe('new');
      writeSteering(root, { ...record, state: 'finished' });
      expect(unfinishedSteering(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

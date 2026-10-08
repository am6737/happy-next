import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enqueueFinish, finishQueuePath, flushFinishes } from './finishQueue';

describe('finish queue', () => {
  it('retains a finish report after transport failure and removes it after delivery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-finish-'));
    const report = { executionId: 'execution-a', dispatchToken: 'token', status: 'completed' as const, finishedAt: new Date().toISOString() };
    try {
      await enqueueFinish(root, report);
      await flushFinishes(root, async () => { throw new Error('offline'); });
      const script = `import { flushFinishes } from './src/orchestrator/finishQueue.ts'; await flushFinishes(${JSON.stringify(root)}, async (value) => console.log(JSON.stringify(value)));`;
      const delivered = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' }).trim();
      expect(JSON.parse(delivered)).toEqual(report);
      const later: unknown[] = [];
      await flushFinishes(root, async (value) => { later.push(value); });
      expect(later).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('does not let a corrupt or rejected report starve later reports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-finish-'));
    try {
      writeFileSync(join(root, '000.json'), '{broken');
      await enqueueFinish(root, { executionId: 'bad', dispatchToken: 'token', status: 'failed', finishedAt: 'now' });
      await enqueueFinish(root, { executionId: 'good', dispatchToken: 'token', status: 'completed', finishedAt: 'now' });
      const delivered: string[] = [];
      const errors: string[] = [];
      await flushFinishes(root, async (report) => {
        if (report.executionId === 'bad') throw new Error('HTTP 400');
        delivered.push(report.executionId);
      }, (file) => errors.push(file));
      expect(delivered).toEqual(['good']);
      expect(errors).toHaveLength(2);
      expect(readdirSync(root).filter((file) => file.endsWith('.json'))).toHaveLength(2);
      await expect(enqueueFinish(root, { executionId: 'bad', dispatchToken: 'other', status: 'failed', finishedAt: 'now' }))
        .rejects.toThrow('another dispatch owner');
      expect(finishQueuePath(root, 'server-a', 'account-a')).not.toBe(finishQueuePath(root, 'server-b', 'account-a'));
      expect(finishQueuePath(root, 'server-a', 'account-a')).not.toBe(finishQueuePath(root, 'server-a', 'account-b'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('sends a queued report once under two real process flushers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-finish-race-'));
    const marker = join(root, 'delivered.txt');
    try {
      await enqueueFinish(root, { executionId: 'race', dispatchToken: 'owner', status: 'completed', finishedAt: 'now' });
      const script = `import { appendFileSync } from 'node:fs'; import { flushFinishes } from './src/orchestrator/finishQueue.ts'; try { await flushFinishes(${JSON.stringify(root)}, async () => { appendFileSync(${JSON.stringify(marker)}, 'sent\\n'); await new Promise(r => setTimeout(r, 300)); }); } catch (error) { if (!String(error).includes('lock unavailable')) throw error; }`;
      const run = () => new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd() });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
      });
      await Promise.all([run(), run()]);
      expect((await import('node:fs')).readFileSync(marker, 'utf8')).toBe('sent\n');
      expect(readdirSync(root).filter((file) => file.endsWith('.json'))).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

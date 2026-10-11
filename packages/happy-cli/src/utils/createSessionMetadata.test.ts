import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionMetadata } from './createSessionMetadata';

vi.mock('@/configuration', () => ({ configuration: { happyHomeDir: '/test-happy-home' } }));
vi.mock('@/projectPath', () => ({ projectPath: () => '/test-lib' }));
vi.mock('@/utils/gitWorktree', () => ({ detectGitWorktree: () => ({ isWorktree: false }) }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

describe('provider teammate metadata', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'happy-metadata-'));
        vi.spyOn(process, 'cwd').mockReturnValue(dir);
        vi.stubEnv('HAPPY_TEAMMATE_ID', 'agent'); vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread');
        vi.stubEnv('HAPPY_TEAMMATE_SESSION_ROLE', 'worker'); vi.stubEnv('HAPPY_TEAMMATE_TASK_ID', 'task');
    });
    afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
    it.each(['codex', 'gemini', 'claude'] as const)('includes shared worker fields for %s', flavor => {
        const context = { source: 'github', resourceType: 'issue', resourceId: 'owner/repo#42', title: 'Fix', deepLink: '/repos/owner/repo/issue/42' };
        vi.stubEnv('HAPPY_TEAMMATE_EXTERNAL_CONTEXT', JSON.stringify(context));
        const { metadata } = createSessionMetadata({ flavor, machineId: 'machine', startedBy: 'daemon' });
        expect(metadata).toMatchObject({ flavor, path: dir, teammate: { id: 'agent', role: 'worker', threadId: 'thread', taskId: 'task' }, externalContext: context });
        vi.stubEnv('HAPPY_TEAMMATE_EXTERNAL_CONTEXT', '{bad');
        expect(createSessionMetadata({ flavor, machineId: 'machine' }).metadata).not.toHaveProperty('externalContext');
    });
});

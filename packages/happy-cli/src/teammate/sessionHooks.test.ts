import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAMMATE_ENV } from 'happy-wire';
import { mergeThreadState, readThreadsState, mergeTaskWorker, readTaskState } from './homeDir';
import { persistTeammateProviderSessionId, teammateSessionMetadata, teammateMetadataFields } from './sessionHooks';
import { logger } from '@/ui/logger';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: { happyHomeDir: '/unused-test-home' } }));

describe('teammate session hooks', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'happy-teammate-hooks-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    it('includes typed controller metadata and optional task id', () => {
        expect(teammateSessionMetadata({})).toBeUndefined();
        const env = { [TEAMMATE_ENV.teammateId]: 'agent', [TEAMMATE_ENV.threadId]: 'thread', [TEAMMATE_ENV.sessionRole]: 'controller' };
        expect(teammateSessionMetadata(env)).toEqual({ id: 'agent', role: 'controller', threadId: 'thread' });
        expect(teammateSessionMetadata({ ...env, [TEAMMATE_ENV.taskId]: 'task' })).toEqual({ id: 'agent', role: 'controller', threadId: 'thread', taskId: 'task' });
        expect(teammateSessionMetadata({ ...env, [TEAMMATE_ENV.taskId]: '' })).not.toHaveProperty('taskId');
    });

    it('merges provider discovery and parallel daemon updates without losing either thread', async () => {
        const env = { [TEAMMATE_ENV.sessionRole]: 'controller', [TEAMMATE_ENV.home]: dir, [TEAMMATE_ENV.threadId]: 'thread' };
        await Promise.all([
            persistTeammateProviderSessionId('claude-1', env),
            mergeThreadState(dir, 'thread', { pid: 123, currentSessionId: 'happy-1', keyPath: '/test.key', lastDispatchAt: 100 }),
            mergeThreadState(dir, 'other', { providerSessionId: 'claude-other' }),
        ]);
        expect(await readThreadsState(dir)).toEqual({
            thread: { providerSessionId: 'claude-1', pid: 123, currentSessionId: 'happy-1', keyPath: '/test.key', lastDispatchAt: 100 },
            other: { providerSessionId: 'claude-other' },
        });
    });

    it('merges worker provider discovery into task state without clobbering the controller', async () => {
        await mergeThreadState(dir, 'thread', { providerSessionId: 'controller-provider' });
        const env = { [TEAMMATE_ENV.home]: dir, [TEAMMATE_ENV.threadId]: 'thread', [TEAMMATE_ENV.sessionRole]: 'worker', [TEAMMATE_ENV.taskId]: 'task', [TEAMMATE_ENV.workerId]: 'worker' };
        await Promise.all([
            persistTeammateProviderSessionId('worker-provider', env),
            mergeTaskWorker(dir, 'task', 'worker', { sessionId: 'worker-session', pid: 123 }),
            mergeTaskWorker(dir, 'task', 'other', { sessionId: 'other-session' }),
        ]);
        expect((await readTaskState(dir, 'task')).workers).toMatchObject({ worker: { sessionId: 'worker-session', pid: 123, providerSessionId: 'worker-provider' }, other: { sessionId: 'other-session' } });
        expect((await readThreadsState(dir)).thread.providerSessionId).toBe('controller-provider');
        await persistTeammateProviderSessionId('ignored', { ...env, [TEAMMATE_ENV.workerId]: '' });
        expect((await readThreadsState(dir)).thread.providerSessionId).toBe('controller-provider');
    });
    it('shares teammate and valid externalContext metadata and ignores malformed optional JSON', () => {
        const context = { source: 'github', resourceType: 'issue', resourceId: 'owner/repo#42', title: 'Fix', deepLink: '/repos/owner/repo/issue/42' };
        const env = { [TEAMMATE_ENV.teammateId]: 'agent', [TEAMMATE_ENV.threadId]: 'thread', [TEAMMATE_ENV.sessionRole]: 'worker', [TEAMMATE_ENV.taskId]: 'task', [TEAMMATE_ENV.externalContext]: JSON.stringify(context) };
        expect(teammateMetadataFields(env)).toEqual({ teammate: { id: 'agent', role: 'worker', threadId: 'thread', taskId: 'task' }, externalContext: context });
        for (const value of ['not JSON', '{}', 'null']) expect(teammateMetadataFields({ ...env, [TEAMMATE_ENV.externalContext]: value })).not.toHaveProperty('externalContext');
    });
    it('ignores unset environment and logs filesystem failures without throwing', async () => {
        await persistTeammateProviderSessionId('claude-1', {});
        const file = join(dir, 'not-a-directory');
        await writeFile(file, 'file');
        await expect(persistTeammateProviderSessionId('claude-1', {
            [TEAMMATE_ENV.sessionRole]: 'controller', [TEAMMATE_ENV.home]: file, [TEAMMATE_ENV.threadId]: 'thread',
        })).resolves.toBeUndefined();
        expect(logger.debug).toHaveBeenCalledWith('[TEAMMATE] Could not persist provider session ID', expect.any(Error));
    });
});

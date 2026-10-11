import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { makeChannelMessage } from '@/teammate/testFixtures';
import { decodeBase64, decrypt } from './encryption';

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('axios', () => ({ default: { post, get, isAxiosError: () => false } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: { serverUrl: 'https://api.example.test' } }));
vi.mock('./apiSession', () => ({ ApiSessionClient: vi.fn() }));
vi.mock('./apiMachine', () => ({ ApiMachineClient: vi.fn() }));

describe('teammate API methods', () => {
    let api: ApiClient;
    beforeEach(async () => {
        post.mockReset(); get.mockReset();
        api = await ApiClient.create({ token: 'test-bearer', encryption: { type: 'legacy', secret: new Uint8Array(32) } });
    });

    it.each(['sent', 'queued'] as const)('sends an encrypted app-compatible user record and returns %s', async mode => {
        const key = new Uint8Array(32).fill(23);
        post.mockResolvedValue({ data: { mode } });
        expect(await api.sendSessionMessage('session-1', 'Review now', key, 'teammate-run:run-1')).toBe(mode);
        const [url, body, config] = post.mock.calls[0];
        expect(url).toBe('https://api.example.test/v3/sessions/session-1/send');
        expect(body.localId).toBe('teammate-run:run-1');
        expect(decrypt(key, 'dataKey', decodeBase64(body.content))).toEqual({
            role: 'user', content: { type: 'text', text: 'Review now' },
            meta: { sentFrom: 'teammate', permissionMode: 'default', model: null, fallbackModel: null, reasoningEffort: null },
        });
        expect(config.headers.Authorization).toBe('Bearer test-bearer');
        expect(config.timeout).toBe(30000);
    });

    it('encodes an explicit permission mode in the encrypted user record', async () => {
        const key = new Uint8Array(32).fill(23);
        post.mockResolvedValue({ data: { mode: 'sent' } });
        await api.sendSessionMessage('session', 'autonomous', key, 'local', 'bypassPermissions');
        expect(decrypt(key, 'dataKey', decodeBase64(post.mock.calls[0][1].content)).meta.permissionMode).toBe('bypassPermissions');
    });

    it('fetches channel messages with sequence bounds and validates the response', async () => {
        const message = makeChannelMessage();
        get.mockResolvedValue({ data: { messages: [message] } });
        expect(await api.getChannelMessages('channel/1', { afterSeq: 11, beforeSeq: 13, limit: 10 })).toEqual([message]);
        expect(get).toHaveBeenCalledWith('https://api.example.test/v1/channels/channel%2F1/messages', {
            params: { afterSeq: 11, beforeSeq: 13, limit: 10 }, headers: { Authorization: 'Bearer test-bearer' }, timeout: 30000,
        });
        get.mockResolvedValue({ data: { messages: [{}] } });
        await expect(api.getChannelMessages('channel')).rejects.toThrow();
    });

    it('posts teammate channel messages with run credentials and validates the response', async () => {
        const message = makeChannelMessage();
        const request = { runId: 'run', dispatchToken: 'dispatch', localId: 'tm:run:1', content: { t: 'encrypted' as const, c: 'ciphertext' } };
        post.mockResolvedValue({ data: { message } });
        expect(await api.sendTeammateChannelMessage(request)).toEqual(message);
        expect(post).toHaveBeenCalledWith('https://api.example.test/v1/teammate-channel-messages', { ...request, kind: 'text', mentions: [] },
            expect.objectContaining({ headers: { Authorization: 'Bearer test-bearer', 'Content-Type': 'application/json' }, timeout: 30000 }));
        post.mockResolvedValue({ data: { message: {} } });
        await expect(api.sendTeammateChannelMessage(request)).rejects.toThrow();
    });

    it('includes raw worker permission mode and selected model in the encrypted record', async () => {
        const key = new Uint8Array(32).fill(23);
        post.mockResolvedValue({ data: { mode: 'sent' } });
        await api.sendSessionMessage('worker', 'Implement', key, 'tm-work:task:1', 'full-auto', 'gpt-test');
        expect(decrypt(key, 'dataKey', decodeBase64(post.mock.calls[0][1].content)).meta).toMatchObject({ permissionMode: 'full-auto', model: 'gpt-test' });
    });
    it('gets a fresh GitHub token and propagates non-2xx failures', async () => {
        get.mockResolvedValue({ data: { token: 'fresh-token', expiresAt: null } });
        expect(await api.getGithubToken()).toBe('fresh-token');
        expect(get).toHaveBeenCalledWith('https://api.example.test/v1/connect/github/token', expect.objectContaining({ headers: { Authorization: 'Bearer test-bearer' }, timeout: 30000 }));
        get.mockRejectedValue(new Error('not connected'));
        await expect(api.getGithubToken()).rejects.toThrow('not connected');
    });
    it('registers workers and posts validated task updates and comments', async () => {
        const auth = { runId: 'run', dispatchToken: 'dispatch' };
        post.mockResolvedValue({ data: { ok: true } });
        await api.registerTeammateSession({ ...auth, sessionId: 'worker', role: 'worker' });
        expect(post).toHaveBeenLastCalledWith('https://api.example.test/v1/teammate-sessions', { ...auth, sessionId: 'worker', role: 'worker' }, expect.any(Object));
        await expect(api.updateTeammateTask(auth)).rejects.toThrow();
        post.mockResolvedValue({ data: { task: { id: 'task', teammateId: 'agent', createdByTeammateId: null, source: 'github-issue', resourceId: 'owner/repo#1', title: 'Fix', url: null, status: 'done', summary: 'Ready', prUrl: null, createdAt: 1, updatedAt: 2 } } });
        expect(await api.updateTeammateTask({ ...auth, status: 'done', summary: 'Ready', verdict: 'approved' })).toMatchObject({ task: { status: 'done' } });
        expect(post).toHaveBeenLastCalledWith('https://api.example.test/v1/teammate-task-updates', { ...auth, status: 'done', summary: 'Ready', verdict: 'approved' }, expect.any(Object));
        post.mockResolvedValue({ data: { task: { id: 'task-2', teammateId: 'agent', createdByTeammateId: null, source: 'github-issue', resourceId: 'owner/repo#2', title: 'Review', url: null, status: 'todo', summary: null, prUrl: null, createdAt: 1, updatedAt: 2 }, issueUrl: 'https://github.com/owner/repo/issues/2', created: true } });
        await api.createTeammateTask({ ...auth, requestId: 'request-1', repo: 'owner/repo', issueNumber: 2, reviewer: 'nova' });
        expect(post).toHaveBeenLastCalledWith('https://api.example.test/v1/teammate-agent-tasks', { ...auth, requestId: 'request-1', repo: 'owner/repo', issueNumber: 2, reviewer: 'nova' }, expect.any(Object));
        post.mockResolvedValue({ data: { url: 'https://github.com/comment' } });
        expect(await api.commentTeammateTask({ ...auth, body: 'Claiming' })).toEqual({ url: 'https://github.com/comment' });
        expect(post).toHaveBeenLastCalledWith('https://api.example.test/v1/teammate-task-comments', { ...auth, body: 'Claiming' }, expect.any(Object));
    });
    it('fetches raw v3 messages with a bounded page', async () => {
        const response = { messages: [{ seq: 2, content: { t: 'encrypted', c: 'ciphertext' } }], hasMore: true, oldestSeq: 1 };
        get.mockResolvedValue({ data: response });
        expect(await api.getSessionMessages('worker/1', 200)).toEqual(response);
        expect(get).toHaveBeenCalledWith('https://api.example.test/v3/sessions/worker%2F1/messages', { params: { limit: 200 }, headers: { Authorization: 'Bearer test-bearer' }, timeout: 30000 });
        get.mockResolvedValue({ data: {} });
        await expect(api.getSessionMessages('worker')).rejects.toThrow('Invalid session messages');
    });
    it('rejects unexpected delivery modes', async () => {
        post.mockResolvedValue({ data: { mode: 'unexpected' } });
        await expect(api.sendSessionMessage('session', 'text', new Uint8Array(32), 'local')).rejects.toThrow('delivery mode');
    });

    it('reports authenticated start and finish callbacks', async () => {
        post.mockResolvedValue({ data: { ok: true } });
        const started = { dispatchToken: 'token', sessionId: 'session', resumed: true, delivery: 'queued' as const };
        const finished = { dispatchToken: 'token', status: 'failed' as const, failureReason: 'spawn_failed' as const, errorMessage: 'refused' };
        await api.reportTeammateRunStarted('run/1', started);
        await api.reportTeammateRunFinished('run/1', finished);
        expect(post).toHaveBeenNthCalledWith(1, 'https://api.example.test/v1/teammate-runs/run%2F1/started', started,
            expect.objectContaining({ headers: { Authorization: 'Bearer test-bearer', 'Content-Type': 'application/json' } }));
        expect(post).toHaveBeenNthCalledWith(2, 'https://api.example.test/v1/teammate-runs/run%2F1/finished', finished, expect.any(Object));
    });

    it('validates active-session responses and sends the machine id as a query parameter', async () => {
        get.mockResolvedValue({ data: { sessionIds: ['session'] } });
        expect(await api.getTeammateActiveSessions('machine-1')).toEqual({ sessionIds: ['session'] });
        expect(get).toHaveBeenCalledWith('https://api.example.test/v1/teammate-runtime/active-sessions', {
            params: { machineId: 'machine-1' }, headers: { Authorization: 'Bearer test-bearer' }, timeout: 30000,
        });
        get.mockResolvedValue({ data: { sessionIds: [123] } });
        await expect(api.getTeammateActiveSessions('machine-1')).rejects.toThrow();
    });
});

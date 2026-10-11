import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { ApiUpdateContainerSchema } from './apiTypes';
import { ChannelApiError } from './apiChannels';
import { delegateTeammateTask, fetchTeammateTaskDetail, fetchTeammateTasksByResource, updateTeammateTask } from './apiTeammateTasks';
import { testTask as task, testTaskDetail as detail } from './teammateTaskTestFixtures';
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('@/utils/time', () => ({ backoff: async (fn: () => Promise<unknown>) => {
    for (let i = 0; i < 5; i++) { try { return await fn(); } catch (error) { if (i === 4) throw error; } }
} }));
const credentials = { token: 'token' } as AuthCredentials;
const fetchMock = vi.fn();
const request = { teammateId: task.teammateId, resourceId: task.resourceId!, title: task.title };
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('task API contract', () => {
    it('delegates with authentication and validates the default source', async () => {
        respond({ task });
        expect(await delegateTeammateTask(credentials, request)).toEqual(task);
        expect(fetchMock).toHaveBeenCalledWith('https://happy.test/v1/teammate-tasks', expect.objectContaining({ method: 'POST',
            headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...request, source: 'github-issue' });
    });
    it('encodes resource and task IDs and validates detail sessions and runs', async () => {
        respond({ tasks: [task] }); respond(detail);
        expect(await fetchTeammateTasksByResource(credentials, task.resourceId!)).toEqual([task]);
        expect(await fetchTeammateTaskDetail(credentials, task.id)).toEqual(detail);
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://happy.test/v1/teammate-tasks?resourceId=owner%2Frepo%2342', 'https://happy.test/v1/teammate-tasks/task%2Fwith%20space']);
    });
    it.each(['stop', 'resume', 'cancel'] as const)('calls the %s action once', async action => {
        respond({ task }); expect(await updateTeammateTask(credentials, task.id, action)).toEqual(task);
        expect(fetchMock).toHaveBeenCalledWith(`https://happy.test/v1/teammate-tasks/task%2Fwith%20space/${action}`, expect.objectContaining({ method: 'POST', body: '{}' }));
    });
    it('rejects invalid resource IDs before sending', async () => {
        await expect(delegateTeammateTask(credentials, { ...request, resourceId: 'owner/repo#0' })).rejects.toThrow();
        await expect(fetchTeammateTasksByResource(credentials, 'owner/repo#0')).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('preserves already_delegated and never replays writes', async () => {
        respond({ error: 'already_delegated' }, 409);
        await expect(delegateTeammateTask(credentials, request)).rejects.toMatchObject({ code: 'already_delegated', status: 409 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        await expect(updateTeammateTask(credentials, task.id, 'cancel')).rejects.toThrow('offline');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('retries reads, while 4xx and malformed successes are not retried', async () => {
        respond({}, 503); respond(detail);
        await expect(fetchTeammateTaskDetail(credentials, task.id)).resolves.toEqual(detail);
        respond({ error: 'not_found' }, 404);
        await expect(fetchTeammateTaskDetail(credentials, task.id)).rejects.toBeInstanceOf(ChannelApiError);
        respond({ ...detail, sessions: [{ sessionId: 's', role: 'invalid', createdAt: 1 }] });
        await expect(fetchTeammateTaskDetail(credentials, task.id)).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    it('adds task updates to the socket union and rejects malformed task status', () => {
        const envelope = { id: 'event', seq: 1, createdAt: 1, body: { t: 'teammate-task-updated', task } };
        expect(ApiUpdateContainerSchema.parse(envelope).body).toEqual(envelope.body);
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { ...envelope.body, task: { ...task, status: 'bad' } } }).success).toBe(false);
    });
});

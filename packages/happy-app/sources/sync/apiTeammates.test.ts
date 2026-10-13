import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeammateSchema, TeammateRunSchema } from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { ApiUpdateContainerSchema } from './apiTypes';
import {
    archiveTeammate, createTeammate, fetchTeammate, fetchTeammateRuns, fetchTeammates,
    fetchTeammateSpend, fetchTeammateTasks, TeammateApiError, updateTeammate,
    startTeammateRun, cancelTeammateRun, fetchTeammateRun, triggerHeartbeat, triggerDreaming,
} from './apiTeammates';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('@/utils/time', () => ({ backoff: async (callback: () => Promise<unknown>) => {
    for (let i = 0; i < 5; i++) { try { return await callback(); } catch (error) { if (i === 4) throw error; } }
} }));

const credentials = { token: 'test-token' } as AuthCredentials;
const profile = TeammateSchema.parse({
    id: 'id/with space', handle: 'atlas', name: 'Atlas', avatar: null, role: '', skills: [], repos: [], instructions: '',
    machineId: 'machine', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'claude', model: null, workerPermissionMode: 'default', workerProfileId: null, workerEnv: null, maxConcurrentRuns: 3,
    monthlyBudgetUsd: null, heartbeatIntervalMin: null, activeHours: null, timezone: 'UTC', dreamingHour: null, canSelfAssign: false,
    status: 'active', createdAt: 0, updatedAt: 0,
});
const fetchMock = vi.fn();
const run = TeammateRunSchema.parse({
    id: 'run/with space', teammateId: profile.id, threadId: 'heartbeat-thread', threadKind: 'heartbeat',
    trigger: 'manual', status: 'queued', attempt: 1, failureReason: null, sessionId: null,
    taskId: null, costUsd: null, queuedAt: 123, startedAt: null, finishedAt: null,
});
function respond(body: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status })); }
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('teammate API', () => {
    it.each([['heartbeat', triggerHeartbeat], ['dreaming', triggerDreaming]] as const)('triggers %s with an authenticated POST and validates the run', async (path, trigger) => {
        respond({ run });
        expect(await trigger(credentials, profile.id)).toEqual({ run });
        expect(fetchMock).toHaveBeenCalledWith(`https://happy.test/v1/teammates/id%2Fwith%20space/${path}`, expect.objectContaining({ method: 'POST', body: '{}' }));
        respond({ run: { id: 'invalid' } });
        await expect(trigger(credentials, profile.id)).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('sends the timezone on create and update', async () => {
        respond({ teammate: profile });
        await createTeammate(credentials, { name: 'Atlas', handle: 'atlas', machineId: 'machine', timezone: 'Asia/Shanghai' });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).timezone).toBe('Asia/Shanghai');
        respond({ teammate: profile });
        await updateTeammate(credentials, profile.id, { timezone: 'Europe/Rome' });
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).timezone).toBe('Europe/Rome');
    });
    it('parses live run updates and rejects malformed runs', () => {
        const envelope = { id: 'event', seq: 2, createdAt: 123, body: { t: 'teammate-run-updated', run } };
        expect(ApiUpdateContainerSchema.parse(envelope).body).toEqual(envelope.body);
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { ...envelope.body, run: { ...run, status: 'invalid' } } }).success).toBe(false);
    });
    it('starts a manual run with a note and escapes the Agent ID', async () => {
        respond({ run });
        expect(await startTeammateRun(credentials, profile.id, { note: 'Review the issue' })).toEqual({ run });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.test/v1/teammates/id%2Fwith%20space/runs', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ note: 'Review the issue' }),
            headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        }));
    });
    it('allows a manual run without a note', async () => {
        respond({ run });
        await startTeammateRun(credentials, profile.id, {});
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    });
    it('rejects notes over the wire limit before sending a request', async () => {
        await expect(startTeammateRun(credentials, profile.id, { note: 'x'.repeat(4001) })).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('maps archived manual runs to a typed 409 without retrying', async () => {
        respond({ error: 'archived' }, 409);
        await expect(startTeammateRun(credentials, profile.id, {})).rejects.toMatchObject({ name: 'TeammateApiError', code: 'archived', status: 409 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('fetches and cancels runs using the run resource and encoded ID', async () => {
        respond({ run });
        expect(await fetchTeammateRun(credentials, run.id)).toEqual({ run });
        expect(fetchMock.mock.calls[0][0]).toBe('https://happy.test/v1/teammate-runs/run%2Fwith%20space');
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
        const cancelled = { ...run, status: 'cancelled', finishedAt: 456, failureReason: 'cancelled_by_user' };
        respond({ run: cancelled });
        expect(await cancelTeammateRun(credentials, run.id)).toEqual({ run: cancelled });
        expect(fetchMock.mock.calls[1][0]).toBe('https://happy.test/v1/teammate-runs/run%2Fwith%20space/cancel');
        expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    });
    it.each(['start', 'cancel', 'fetch'] as const)('validates the %s response', async endpoint => {
        respond({ run: { id: 'invalid' } });
        const operation = endpoint === 'start' ? startTeammateRun(credentials, profile.id, {})
            : endpoint === 'cancel' ? cancelTeammateRun(credentials, run.id) : fetchTeammateRun(credentials, run.id);
        await expect(operation).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each(['start', 'cancel'] as const)('does not replay %s after a lost response', async endpoint => {
        fetchMock.mockRejectedValue(new Error('connection lost'));
        await expect(endpoint === 'start' ? startTeammateRun(credentials, profile.id, {}) : cancelTeammateRun(credentials, run.id)).rejects.toThrow('connection lost');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('parses the account socket envelope and rejects an invalid teammate', () => {
        const envelope = { id: 'event', seq: 1, createdAt: 0, body: { t: 'teammate-updated', teammate: profile } };
        expect(ApiUpdateContainerSchema.parse(envelope).body).toEqual(envelope.body);
        expect(ApiUpdateContainerSchema.safeParse({ ...envelope, body: { t: 'teammate-updated', teammate: { id: 'invalid' } } }).success).toBe(false);
    });
    it('uses auth, query strings, escaped IDs and validates all eight endpoint responses', async () => {
        respond({ teammates: [profile] });
        expect(await fetchTeammates(credentials, true)).toEqual([profile]);
        expect(fetchMock.mock.calls[0][0]).toBe('https://happy.test/v1/teammates?includeArchived=true');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
        respond({ teammate: profile });
        await createTeammate(credentials, { name: 'Atlas', handle: 'atlas', machineId: 'machine' });
        expect(fetchMock.mock.calls[1][1].method).toBe('POST');
        respond({ teammate: profile });
        expect(await fetchTeammate(credentials, profile.id)).toEqual(profile);
        expect(fetchMock.mock.calls[2][0]).toContain('/id%2Fwith%20space');
        respond({ teammate: profile });
        await updateTeammate(credentials, profile.id, { status: 'paused' });
        expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ status: 'paused' });
        respond({ teammate: { ...profile, status: 'archived' } });
        expect((await archiveTeammate(credentials, profile.id)).status).toBe('archived');
        expect(fetchMock.mock.calls[4][0]).toMatch(/\/archive$/);
        respond({ runs: [] });
        expect(await fetchTeammateRuns(credentials, profile.id, { limit: 500, before: 123 })).toEqual([]);
        expect(fetchMock.mock.calls[5][0]).toContain('/runs?limit=200&before=123');
        respond({ tasks: [] });
        expect(await fetchTeammateTasks(credentials, profile.id, 'active')).toEqual([]);
        expect(fetchMock.mock.calls[6][0]).toContain('/tasks?status=active');
        const spend = { teammateId: profile.id, monthStart: 0, spentUsd: 12, budgetUsd: null, tokens: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 } };
        respond({ spend });
        expect(await fetchTeammateSpend(credentials, profile.id)).toEqual(spend);
    });
    it.each(['name_taken', 'machine_not_found', 'archived'] as const)('surfaces %s immediately without retrying', async code => {
        respond({ error: code }, code === 'machine_not_found' ? 400 : 409);
        await expect(createTeammate(credentials, { name: 'Atlas', handle: 'atlas', machineId: 'machine' })).rejects.toMatchObject({ name: 'TeammateApiError', code });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('does not retry 404 reads or malformed success responses', async () => {
        respond({ error: 'not_found' }, 404);
        await expect(fetchTeammate(credentials, 'missing')).rejects.toBeInstanceOf(TeammateApiError);
        respond({ teammate: { id: 'invalid' } });
        await expect(fetchTeammate(credentials, 'invalid')).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('caps transient GET retries at three attempts', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
        await expect(fetchTeammates(credentials)).rejects.toMatchObject({ status: 503 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    it('does not replay a mutation after a network failure', async () => {
        fetchMock.mockRejectedValue(new Error('connection lost'));
        await expect(createTeammate(credentials, { name: 'Atlas', handle: 'atlas', machineId: 'machine' })).rejects.toThrow('connection lost');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('validates requests locally and strips the immutable handle from updates', async () => {
        await expect(createTeammate(credentials, { name: '', handle: '!', machineId: '' })).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
        respond({ teammate: profile });
        await updateTeammate(credentials, profile.id, { name: 'New name', handle: 'replacement' } as Parameters<typeof updateTeammate>[2]);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'New name' });
    });
});

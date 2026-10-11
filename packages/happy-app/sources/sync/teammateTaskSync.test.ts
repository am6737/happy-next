import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { TeammateTaskSync } from './teammateTaskSync';
import * as api from './apiTeammateTasks';
import { testTask as task, testTaskDetail as detail } from './teammateTaskTestFixtures';

const harness = vi.hoisted(() => ({ state: {} as any, server: 'https://first' }));
vi.mock('./storage', () => ({ storage: { getState: () => harness.state } }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => harness.server }));
vi.mock('./apiTeammateTasks', () => ({ fetchTeammateTaskDetail: vi.fn(), fetchTeammateTasksByResource: vi.fn() }));
vi.mock('./apiTeammates', () => ({ fetchTeammate: vi.fn() }));
let credentials: AuthCredentials;
let client: TeammateTaskSync;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
    vi.clearAllMocks(); harness.server = 'https://first'; credentials = { token: 'token' } as AuthCredentials;
    harness.state = { teammates: { agent: { id: 'agent' } }, teammateTaskDetails: { [task.id]: detail },
        applyTeammateTaskDetail: vi.fn(), applyTeammateTaskList: vi.fn(), applyTeammates: vi.fn() };
    client = new TeammateTaskSync(() => credentials);
    vi.mocked(api.fetchTeammateTaskDetail).mockResolvedValue(detail);
    vi.mocked(api.fetchTeammateTasksByResource).mockResolvedValue([task]);
});
describe('task read synchronization', () => {
    it('supplies the pre-request detail baseline for merging socket run changes', async () => {
        const baseline = harness.state.teammateTaskDetails[task.id];
        await client.loadDetail(task.id);
        expect(harness.state.applyTeammateTaskDetail).toHaveBeenCalledWith(detail, baseline);
        await client.loadResource(task.resourceId!);
        expect(harness.state.applyTeammateTaskList).toHaveBeenCalledWith([task], task.resourceId);
    });
    it('ignores detail responses from a previous server', async () => {
        const response = deferred<typeof detail>(); vi.mocked(api.fetchTeammateTaskDetail).mockReturnValueOnce(response.promise);
        const read = client.loadDetail(task.id);
        harness.server = 'https://second'; response.resolve(detail); await read;
        expect(harness.state.applyTeammateTaskDetail).not.toHaveBeenCalled();
    });
    it('ignores resource responses from a previous account', async () => {
        const response = deferred<typeof task[]>(); vi.mocked(api.fetchTeammateTasksByResource).mockReturnValueOnce(response.promise);
        const read = client.loadResource(task.resourceId!);
        credentials = { token: 'other' } as AuthCredentials; response.resolve([task]); await read;
        expect(harness.state.applyTeammateTaskList).not.toHaveBeenCalled();
    });
    it('refreshes visible tasks after invalidation and releases the last watcher', async () => {
        const stop = client.watch('task', task.id);
        await vi.waitFor(() => expect(harness.state.applyTeammateTaskDetail).toHaveBeenCalledTimes(1));
        client.invalidate(task.id);
        await vi.waitFor(() => expect(harness.state.applyTeammateTaskDetail).toHaveBeenCalledTimes(2));
        stop(); client.refresh(); client.invalidate(task.id);
        expect(api.fetchTeammateTaskDetail).toHaveBeenCalledTimes(2);
    });
    it('keeps a shared watch alive until every panel releases it', async () => {
        const stop1 = client.watch('task', task.id), stop2 = client.watch('task', task.id);
        await vi.waitFor(() => expect(harness.state.applyTeammateTaskDetail).toHaveBeenCalled());
        stop1(); client.refresh();
        await vi.waitFor(() => expect(vi.mocked(api.fetchTeammateTaskDetail).mock.calls.length).toBeGreaterThan(1));
        stop2();
        const calls = vi.mocked(api.fetchTeammateTaskDetail).mock.calls.length;
        client.refresh(); expect(api.fetchTeammateTaskDetail).toHaveBeenCalledTimes(calls);
    });
});

import type { AuthCredentials } from '@/auth/tokenStorage';
import { InvalidateSync } from '@/utils/sync';
import { storage } from './storage';
import { getServerUrl } from './serverConfig';
import { fetchTeammate } from './apiTeammates';
import { fetchTeammateTaskDetail, fetchTeammateTasksByResource } from './apiTeammateTasks';

/** Focused panels retry reads and refresh after socket changes, reconnect and foreground. */
export class TeammateTaskSync {
    private visible = new Map<string, { sync: InvalidateSync; count: number }>();
    constructor(private readonly credentials: () => AuthCredentials) {}
    isCurrent(credentials: AuthCredentials, server = getServerUrl()) {
        return credentials === this.credentials() && server === getServerUrl();
    }
    watch(kind: 'task' | 'resource', id: string) {
        const key = `${kind}:${id}`;
        let entry = this.visible.get(key);
        if (!entry) {
            entry = { count: 0, sync: new InvalidateSync(() => kind === 'task' ? this.loadDetail(id) : this.loadResource(id)) };
            this.visible.set(key, entry);
        }
        entry.count++;
        entry.sync.invalidate();
        return () => { if (--entry!.count === 0) { entry!.sync.stop(); this.visible.delete(key); } };
    }
    refresh = () => { for (const entry of this.visible.values()) entry.sync.invalidate(); };
    invalidate(taskId: string) { this.visible.get(`task:${taskId}`)?.sync.invalidate(); }
    async loadDetail(id: string) {
        const credentials = this.credentials(), server = getServerUrl();
        const baseline = storage.getState().teammateTaskDetails[id];
        const detail = await fetchTeammateTaskDetail(credentials, id);
        if (credentials !== this.credentials() || server !== getServerUrl()) return;
        storage.getState().applyTeammateTaskDetail(detail, baseline);
        if (!storage.getState().teammates[detail.task.teammateId]) {
            const teammate = await fetchTeammate(credentials, detail.task.teammateId);
            if (credentials === this.credentials() && server === getServerUrl()) storage.getState().applyTeammates([teammate]);
        }
    }
    async loadResource(resourceId: string) {
        const credentials = this.credentials(), server = getServerUrl();
        const tasks = await fetchTeammateTasksByResource(credentials, resourceId);
        if (credentials === this.credentials() && server === getServerUrl()) storage.getState().applyTeammateTaskList(tasks, resourceId);
    }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { Teammate } from 'happy-wire';
import { delegateIssueToTeammate } from './teammateTaskDelegate';
import { delegateTeammateTask } from './apiTeammateTasks';
import { testTask as task } from './teammateTaskTestFixtures';
vi.mock('./apiTeammateTasks', () => ({ delegateTeammateTask: vi.fn() }));
const credentials = { token: 'token' } as AuthCredentials;
const teammate = { id: 'agent' } as Teammate;
const issue = { resourceId: task.resourceId!, title: task.title };
beforeEach(() => vi.clearAllMocks());
describe('delegation ordering', () => {
    it('waits for the encrypted DM before assigning the task', async () => {
        let resolve!: () => void;
        const dm = new Promise<void>(r => { resolve = r; });
        const channels = { openDm: vi.fn(() => dm) };
        vi.mocked(delegateTeammateTask).mockResolvedValue(task);
        const operation = delegateIssueToTeammate(credentials, teammate, issue, channels);
        expect(channels.openDm).toHaveBeenCalledWith(teammate);
        expect(delegateTeammateTask).not.toHaveBeenCalled();
        resolve();
        expect(await operation).toEqual(task);
        expect(delegateTeammateTask).toHaveBeenCalledWith(credentials, { ...issue, teammateId: teammate.id });
    });
    it('does not delegate if the DM cannot be ensured', async () => {
        await expect(delegateIssueToTeammate(credentials, teammate, issue, { openDm: async () => { throw new Error('keys unavailable'); } })).rejects.toThrow('keys unavailable');
        expect(delegateTeammateTask).not.toHaveBeenCalled();
    });
});

it('does not write a task if the account changes while ensuring its DM', async () => {
    let current = true;
    const channels = { openDm: async () => { current = false; } };
    await expect(delegateIssueToTeammate(credentials, teammate, issue, channels, () => current)).rejects.toThrow('Account or server changed');
    expect(delegateTeammateTask).not.toHaveBeenCalled();
});
it('does not return a task for caching after its account changed', async () => {
    let current = true;
    vi.mocked(delegateTeammateTask).mockImplementationOnce(async () => { current = false; return task; });
    await expect(delegateIssueToTeammate(credentials, teammate, issue, { openDm: async () => {} }, () => current)).rejects.toThrow('Account or server changed');
});

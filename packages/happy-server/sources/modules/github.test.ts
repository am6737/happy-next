import { describe, expect, it, vi } from 'vitest';
import { applyAuthorizedPullRequestEvent, applyGithubGrantRevocation } from './github';

function transaction(grants: Array<{ accountId: string }>, work: Array<Record<string, unknown>>) {
    return {
        aiGithubRepositoryGrant: { findMany: vi.fn().mockResolvedValue(grants) },
        aiWorkItem: {
            findMany: vi.fn().mockResolvedValue(work),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        orchestratorTask: { findUnique: vi.fn().mockResolvedValue({ branchName: 'agent/task', commitSha: 'abc' }) },
    };
}

const payload = {
    action: 'closed', repository: { id: 123, full_name: 'acme/project' },
    pull_request: { number: 7, html_url: 'https://github.com/acme/project/pull/7',
        title: 'Fix parser', body: 'Fixes #42', merged: true, merged_at: '2026-10-07T00:00:00Z',
        updated_at: '2026-10-07T00:00:00Z', head: { ref: 'agent/task', sha: 'abc' } },
};

describe('authorized GitHub PR delivery', () => {
    it('does not touch any account without an explicit repository grant', async () => {
        const tx = transaction([], []);
        expect(await applyAuthorizedPullRequestEvent(tx as any, payload)).toBe(0);
        expect(tx.aiWorkItem.findMany).not.toHaveBeenCalled();
    });

    it('filters by account and repository and approves a matching merged PR', async () => {
        const tx = transaction([{ accountId: 'owner' }], [{ id: 'work', orchestratorTaskId: 'task', pullRequestNumber: 7,
            pullRequestUrl: payload.pull_request.html_url, pullRequestState: 'open', pullRequestEventAt: null }]);
        expect(await applyAuthorizedPullRequestEvent(tx as any, payload)).toBe(1);
        expect(tx.aiGithubRepositoryGrant.findMany).toHaveBeenCalledWith({ where: {
            repositoryId: 123n, fullName: 'acme/project', installationId: null,
        }, select: { accountId: true } });
        expect(tx.aiWorkItem.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({
            accountId: 'owner', sourceResourceId: { in: ['acme/project#42'] },
        }), select: expect.any(Object) });
        expect(tx.aiWorkItem.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ accountId: 'owner' }),
            data: expect.objectContaining({ pullRequestState: 'merged', requiresDecision: true }) });
    });

    it('ignores another PR and stale events', async () => {
        const other = transaction([{ accountId: 'owner' }], [{ id: 'work', orchestratorTaskId: 'task', pullRequestNumber: 8,
            pullRequestState: 'open', pullRequestEventAt: null }]);
        expect(await applyAuthorizedPullRequestEvent(other as any, payload)).toBe(0);
        expect(other.aiWorkItem.updateMany).not.toHaveBeenCalled();
        const older = transaction([{ accountId: 'owner' }], [{ id: 'work', orchestratorTaskId: 'task', pullRequestNumber: 7,
            pullRequestState: 'closed', pullRequestEventAt: new Date('2026-10-08T00:00:00Z') }]);
        expect(await applyAuthorizedPullRequestEvent(older as any, payload)).toBe(0);
        expect(older.aiWorkItem.updateMany).not.toHaveBeenCalled();
    });

    it('does not approve a closed unmerged PR and can reopen the same PR', async () => {
        const closed = transaction([{ accountId: 'owner' }], [{ id: 'work', orchestratorTaskId: 'task',
            pullRequestNumber: 7, pullRequestState: 'open', pullRequestEventAt: null }]);
        await applyAuthorizedPullRequestEvent(closed as any, { ...payload,
            pull_request: { ...payload.pull_request, merged: false } });
        expect(closed.aiWorkItem.updateMany).toHaveBeenCalledWith({ where: expect.any(Object), data: expect.objectContaining({
            pullRequestState: 'closed',
        }) });
        expect(closed.aiWorkItem.updateMany.mock.calls[0][0].data.acceptanceStatus).toBeUndefined();

        const reopened = transaction([{ accountId: 'owner' }], [{ id: 'work', orchestratorTaskId: 'task',
            pullRequestNumber: 7, pullRequestState: 'closed', pullRequestEventAt: new Date('2026-10-07T00:00:00Z') }]);
        await applyAuthorizedPullRequestEvent(reopened as any, { ...payload, action: 'reopened',
            pull_request: { ...payload.pull_request, merged: false, state: 'open', updated_at: '2026-10-08T00:00:00Z' } });
        expect(reopened.aiWorkItem.updateMany).toHaveBeenCalledWith({ where: expect.any(Object), data: expect.objectContaining({
            pullRequestState: 'open',
        }) });
    });
});

describe('signed GitHub grant revocation', () => {
    it('scopes installation deletion and repository removal to the installation', async () => {
        const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
        const tx = { aiGithubRepositoryGrant: { deleteMany } };
        expect(await applyGithubGrantRevocation(tx as any, 'installation', {
            action: 'deleted', installation: { id: 12 },
        })).toBe(1);
        expect(deleteMany).toHaveBeenCalledWith({ where: { installationId: 12n } });
        await applyGithubGrantRevocation(tx as any, 'installation_repositories', {
            action: 'removed', installation: { id: 12 }, repositories_removed: [{ id: 42 }, { id: 43 }],
        });
        expect(deleteMany).toHaveBeenLastCalledWith({ where: {
            installationId: 12n, repositoryId: { in: [42n, 43n] },
        } });
    });

    it('ignores incomplete identities and scopes user authorization revocation', async () => {
        const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
        const findMany = vi.fn().mockResolvedValue([{ id: 'account' }]);
        const tx = { aiGithubRepositoryGrant: { deleteMany }, account: { findMany } };
        expect(await applyGithubGrantRevocation(tx as any, 'installation', {
            action: 'deleted', installation: { id: -1 },
        })).toBe(0);
        expect(deleteMany).not.toHaveBeenCalled();
        await applyGithubGrantRevocation(tx as any, 'github_app_authorization', {
            action: 'revoked', sender: { id: 77 },
        });
        expect(findMany).toHaveBeenCalledWith({ where: { githubUserId: '77' }, select: { id: true } });
        expect(deleteMany).toHaveBeenCalledWith({ where: { accountId: { in: ['account'] } } });
    });
});

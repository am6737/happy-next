import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateMany: vi.fn(), repoGet: vi.fn(), actorGet: vi.fn(), issuesList: vi.fn(), issueGet: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: { aiGithubIssueIntent: { updateMany: mocks.updateMany } } }));
vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: vi.fn(async () => ({ rest: {
    repos: { get: mocks.repoGet }, users: { getAuthenticated: mocks.actorGet },
    issues: { listForRepo: mocks.issuesList, get: mocks.issueGet },
} })) }));

import { findGithubIssueForIntent, reconcileGithubIssueIntent, verifyGithubIssueNumber } from './githubIssueIntent';

const intent = { accountId: 'account', conversationId: 'conversation', clientMessageId: 'message',
    repositoryId: 123n, owner: 'acme', repo: 'project', title: 'Task', body: 'Task\n<!-- marker -->',
    status: 'creating', issueNumber: null } as any;

describe('durable GitHub issue reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.repoGet.mockResolvedValue({ data: { id: 123, permissions: { push: true } } });
        mocks.actorGet.mockResolvedValue({ data: { id: 7 } });
        mocks.updateMany.mockResolvedValue({ count: 1 });
    });

    it('accepts only an exact issue from the authenticated author and repository', async () => {
        mocks.issuesList.mockResolvedValue({ data: [
            { number: 10, title: 'Task', body: intent.body, user: { id: 8 } },
            { number: 11, title: 'Task', body: intent.body, user: { id: 7 } },
        ] });
        expect(await findGithubIssueForIntent(intent)).toBe(11);
        expect(await reconcileGithubIssueIntent(intent)).toBe('found');
        expect(mocks.updateMany.mock.calls[1][0].data).toMatchObject({ status: 'succeeded', issueNumber: 11 });
    });

    it('keeps an unmatched external call uncertain without creating another issue', async () => {
        mocks.issuesList.mockResolvedValue({ data: [] });
        expect(await reconcileGithubIssueIntent(intent)).toBe('uncertain');
        expect(mocks.updateMany.mock.calls[1][0].data).toMatchObject({ status: 'uncertain',
            issueNumber: null, lastErrorCode: 'not_found' });
    });

    it('rejects a repository identity change', async () => {
        mocks.repoGet.mockResolvedValue({ data: { id: 999, permissions: { push: true } } });
        await expect(findGithubIssueForIntent(intent)).rejects.toThrow('Repository authorization changed');
        expect(mocks.issuesList).not.toHaveBeenCalled();
    });

    it('manual recovery requires exact issue identity and the OAuth author', async () => {
        mocks.issueGet.mockResolvedValue({ data: { number: 42, title: 'Task', body: intent.body,
            user: { id: 7 } } });
        expect(await verifyGithubIssueNumber(intent, 42)).toBe(true);
        mocks.issueGet.mockResolvedValue({ data: { number: 42, title: 'Task', body: intent.body,
            user: { id: 8 } } });
        expect(await verifyGithubIssueNumber(intent, 42)).toBe(false);
    });
});

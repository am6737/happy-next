import { describe, expect, test, vi } from 'vitest';
import { buildWorkItemSearchQuery, githubRoutes } from './githubRoutes';
import { getUserOctokit } from '@/app/github/githubApi';

vi.mock('@/app/github/githubApi', () => ({
    getUserOctokit: vi.fn(),
    GitHubNotConnectedError: class extends Error {},
}));

describe('buildWorkItemSearchQuery', () => {
    test('builds a cross-repository review queue', () => {
        expect(buildWorkItemSearchQuery({
            type: 'pulls',
            state: 'open',
            scope: 'review-requested',
        })).toBe('is:pr is:open review-requested:@me');
    });

    test('supports repository, author, and title filters', () => {
        expect(buildWorkItemSearchQuery({
            type: 'issues',
            state: 'closed',
            scope: 'created',
            repository: 'openai/codex',
            search: 'mobile crash',
        })).toBe('"mobile crash" in:title is:issue is:closed author:@me repo:openai/codex');
    });

    test('removes characters that can break a quoted search value', () => {
        expect(buildWorkItemSearchQuery({
            type: 'issues',
            state: 'all',
            scope: 'assigned',
            search: 'fix "login"\\flow',
        })).toBe('"fix  login  flow" in:title is:issue assignee:@me');
    });

    test('does not restrict all to personal involvement and separates closed from merged pull requests', () => {
        expect(buildWorkItemSearchQuery({
            type: 'pulls',
            state: 'closed',
            scope: 'all',
        })).toBe('is:pr is:closed is:unmerged');
    });
});

describe('work-items repository boundary', () => {
    test.each([
        [{ status: 401 }, 401, 'github_token_expired'],
        [{ status: 403 }, 403, 'GitHub access denied. Check repository permissions and organization OAuth App approval.'],
        [{ status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } }, 429, 'rate_limited'],
        [{ status: 403, response: { headers: { 'retry-after': '60' } } }, 429, 'rate_limited'],
    ])('distinguishes authorization, permissions and rate limits: %j', async (error, status, message) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            vi.mocked(getUserOctokit).mockRejectedValueOnce(error);
            let handler: any;
            githubRoutes({
                authenticate: vi.fn(),
                get: (path: string, _options: unknown, callback: unknown) => { if (path === '/v1/github/work-items') handler = callback; },
                post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
            } as any);
            const reply = { send: vi.fn(), code: vi.fn().mockReturnThis() };
            await handler({ userId: 'user', query: {} }, reply);
            expect(reply.code).toHaveBeenCalledWith(status);
            expect(reply.send).toHaveBeenCalledWith({ error: message });
        } finally {
            log.mockRestore();
        }
    });

    test.each(['issues', 'pulls'])('limits %s to picker repositories without involvement filtering', async (type) => {
        const search = vi.fn().mockResolvedValue({ data: { items: [], total_count: 0, incomplete_results: false } });
        const graphql = vi.fn().mockResolvedValue({ viewer: { repositories: {
            nodes: [{ nameWithOwner: 'me/own' }, { nameWithOwner: 'org/team' }],
            pageInfo: { hasNextPage: false, endCursor: null },
        } } });
        vi.mocked(getUserOctokit).mockResolvedValue({ auth: async () => ({ token: `test-${type}` }), graphql, rest: { search: { issuesAndPullRequests: search } } } as any);
        let handler: any;
        githubRoutes({
            authenticate: vi.fn(),
            get: (path: string, _options: unknown, callback: unknown) => { if (path === '/v1/github/work-items') handler = callback; },
            post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(),
        } as any);
        const reply = { send: vi.fn(), code: vi.fn().mockReturnThis() };
        await handler({ userId: 'user', query: { type, state: 'open', scope: 'all', limit: 30 } }, reply);
        expect(search).toHaveBeenCalledWith(expect.objectContaining({
            q: `${type === 'issues' ? 'is:issue' : 'is:pr'} is:open repo:me/own repo:org/team`,
        }));
        await handler({ userId: 'user', query: { type, state: 'open', scope: 'all', limit: 30 } }, reply);
        expect(search).toHaveBeenCalledTimes(1);
        expect(graphql).toHaveBeenCalledTimes(1);
        await handler({ userId: 'user', query: { type, state: 'open', scope: 'all', limit: 30, refresh: 'true' } }, reply);
        expect(search).toHaveBeenCalledTimes(2);
        expect(graphql).toHaveBeenCalledTimes(2);
        search.mockClear();
        await handler({ userId: 'user', query: { type, state: 'open', scope: 'all', limit: 30, repository: 'stranger/outside' } }, reply);
        expect(search).not.toHaveBeenCalled();
        expect(reply.send).toHaveBeenLastCalledWith({ items: [], totalCount: 0, hasMore: false, nextCursor: null });
    });
});

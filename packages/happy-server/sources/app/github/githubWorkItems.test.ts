import { describe, expect, test, vi } from 'vitest';
import type { Octokit } from 'octokit';
import { buildRepositoryQueries, listWorkRepositories, searchRepositoryWorkItems } from './githubWorkItems';
import { createWorkMetrics, githubWorkCache } from './githubWorkCache';

function mockSearch(groups: Record<string, { id: number; updated_at: string }[]>) {
    const search = vi.fn(async ({ q, page, per_page }: { q: string; page: number; per_page: number }) => ({
        data: { items: groups[q].slice((page - 1) * per_page, page * per_page), total_count: groups[q].length, incomplete_results: false },
    }));
    return { search, octokit: { rest: { search: { issuesAndPullRequests: search } } } as unknown as Octokit };
}

describe('repository-scoped work items', () => {
    test('reuses fetched pages for repeat visits and pagination with measurable request savings', async () => {
        const scope = 'request-savings';
        githubWorkCache.invalidate(scope);
        const items = Array.from({ length: 100 }, (_, i) => ({ id: i, updated_at: new Date(1700000000000 - i * 1000).toISOString() }));
        const { octokit, search } = mockSearch({ 'is:issue repo:org/team': items });
        const queries = ['is:issue repo:org/team'];
        const cold = { scope, metrics: createWorkMetrics() };
        const first = await searchRepositoryWorkItems(octokit, queries, 30, undefined, cold);
        const warm = { scope, metrics: createWorkMetrics() };
        expect(await searchRepositoryWorkItems(octokit, queries, 30, undefined, warm)).toEqual(first);
        const second = await searchRepositoryWorkItems(octokit, queries, 30, first.nextCursor!, warm);
        expect(second.items.map((i) => i.id)).toEqual(items.slice(30, 60).map((i) => i.id));
        expect(search).toHaveBeenCalledTimes(1);
        expect(cold.metrics.searchRequests).toBe(1);
        expect(warm.metrics.searchRequests).toBe(0);
        expect(warm.metrics.searchCacheHits).toBe(2);
        githubWorkCache.invalidate(scope);
        await searchRepositoryWorkItems(octokit, queries, 30, undefined, warm);
        expect(search).toHaveBeenCalledTimes(2);
    });

    test('shares the repository list between Issues and PRs', async () => {
        const scope = 'shared-repositories';
        githubWorkCache.invalidate(scope);
        const graphql = vi.fn().mockResolvedValue({ viewer: { repositories: { nodes: [{ nameWithOwner: 'org/team' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
        const octokit = { graphql } as unknown as Octokit;
        const context = { scope, metrics: createWorkMetrics() };
        await Promise.all([listWorkRepositories(octokit, context), listWorkRepositories(octokit, context)]);
        expect(graphql).toHaveBeenCalledTimes(1);
        expect(context.metrics.repositoryRequests).toBe(1);
        expect(context.metrics.repositoryCacheHits).toBe(1);
    });
    test('reads every picker repository page with the same affiliations', async () => {
        const graphql = vi.fn()
            .mockResolvedValueOnce({ viewer: { repositories: { nodes: [{ nameWithOwner: 'me/own' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } })
            .mockResolvedValueOnce({ viewer: { repositories: { nodes: [{ nameWithOwner: 'org/team' }, { nameWithOwner: 'me/own' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
        expect(await listWorkRepositories({ graphql } as unknown as Octokit)).toEqual(['me/own', 'org/team']);
        expect(graphql.mock.calls[0][0]).toContain('affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]');
        expect(graphql.mock.calls[1][1]).toEqual({ cursor: 'next' });
    });

    test('never generates a global query for an empty repository list', async () => {
        expect(buildRepositoryQueries('is:issue', [])).toEqual([]);
        const { octokit, search } = mockSearch({});
        expect(await searchRepositoryWorkItems(octokit, [], 30)).toEqual({ items: [], totalCount: 0, hasMore: false, nextCursor: null });
        expect(search).not.toHaveBeenCalled();
    });

    test('splits long repository lists without losing scope', () => {
        const repositories = Array.from({ length: 50 }, (_, i) => `org/repository-${i}`);
        const queries = buildRepositoryQueries('is:pr is:open', repositories);
        expect(queries.length).toBeGreaterThan(1);
        expect(queries.every((q) => q.length <= 256 && q.startsWith('is:pr is:open repo:'))).toBe(true);
        expect(queries.flatMap((q) => q.match(/repo:[^ ]+/g) ?? [])).toEqual(repositories.map((r) => `repo:${r}`));
        expect(() => buildRepositoryQueries('x'.repeat(250), ['org/repo'])).toThrow('too long');
    });

    test.each(['is:issue', 'is:pr'])('merges %s groups by update time and resumes without omissions', async (type) => {
        const queries = [`${type} repo:me/own`, `${type} repo:org/team`];
        const { octokit, search } = mockSearch({
            [queries[0]]: [{ id: 1, updated_at: '2026-09-06' }, { id: 3, updated_at: '2026-09-04' }],
            [queries[1]]: [{ id: 2, updated_at: '2026-09-05' }, { id: 4, updated_at: '2026-09-03' }],
        });
        const first = await searchRepositoryWorkItems(octokit, queries, 2);
        expect(first.items.map((i) => i.id)).toEqual([1, 2]);
        expect(first.totalCount).toBe(4);
        const second = await searchRepositoryWorkItems(octokit, queries, 2, first.nextCursor!);
        expect(second.items.map((i) => i.id)).toEqual([3, 4]);
        expect(second.hasMore).toBe(false);
        expect(search.mock.calls.every(([request]) => queries.includes(request.q))).toBe(true);
        await expect(searchRepositoryWorkItems(octokit, [queries[0]], 2, first.nextCursor!)).rejects.toThrow('refresh');
    });

    test('continues across GitHub page boundaries', async () => {
        const items = Array.from({ length: 135 }, (_, i) => ({ id: i, updated_at: new Date(1700000000000 - i * 1000).toISOString() }));
        const { octokit } = mockSearch({ 'is:issue repo:org/team': items });
        const collected: number[] = [];
        let cursor: string | undefined;
        do {
            const result = await searchRepositoryWorkItems(octokit, ['is:issue repo:org/team'], 30, cursor);
            collected.push(...result.items.map((item) => item.id));
            cursor = result.nextCursor ?? undefined;
        } while (cursor);
        expect(collected).toEqual(items.map((item) => item.id));
    });

    test('preserves upstream order for equal timestamps across pagination', async () => {
        const { octokit } = mockSearch({ q: [{ id: 1, updated_at: '2026-09-06' }, { id: 2, updated_at: '2026-09-06' }] });
        const first = await searchRepositoryWorkItems(octokit, ['q'], 1);
        const second = await searchRepositoryWorkItems(octokit, ['q'], 1, first.nextCursor!);
        expect([...first.items, ...second.items].map((item) => item.id)).toEqual([1, 2]);
    });

    test('does not silently accept incomplete GitHub results', async () => {
        const { octokit, search } = mockSearch({});
        search.mockResolvedValueOnce({ data: { items: [], total_count: 5, incomplete_results: true } });
        await expect(searchRepositoryWorkItems(octokit, ['is:pr repo:org/team'], 30)).rejects.toThrow('incomplete');
    });
});

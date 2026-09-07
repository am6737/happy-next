import { createHash } from 'node:crypto';
import type { Octokit } from 'octokit';
import { githubWorkCache, type WorkCacheContext } from './githubWorkCache';

export const REPOSITORY_AFFILIATIONS = '[OWNER, COLLABORATOR, ORGANIZATION_MEMBER]';

export async function listWorkRepositories(octokit: Pick<Octokit, 'graphql'>, context?: WorkCacheContext): Promise<string[]> {
    if (context) {
        return githubWorkCache.get(context.scope, 'repositories', 60_000,
            () => loadWorkRepositories(octokit, context), () => { context.metrics.repositoryCacheHits++; });
    }
    return loadWorkRepositories(octokit);
}

async function loadWorkRepositories(octokit: Pick<Octokit, 'graphql'>, context?: WorkCacheContext): Promise<string[]> {
    const names = new Set<string>();
    let cursor: string | null = null;
    do {
        if (context) context.metrics.repositoryRequests++;
        const result: { viewer: { repositories: {
            nodes: { nameWithOwner: string }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
        } } } = await octokit.graphql(`
            query($cursor: String) {
                viewer {
                    repositories(first: 100, after: $cursor, affiliations: ${REPOSITORY_AFFILIATIONS}) {
                        nodes { nameWithOwner }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            }
        `, { cursor });
        const connection = result.viewer.repositories;
        connection.nodes.forEach((repo) => names.add(repo.nameWithOwner));
        cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (cursor);
    return [...names].sort();
}

export function buildRepositoryQueries(baseQuery: string, repositories: string[]): string[] {
    const queries: string[] = [];
    let query = baseQuery;
    for (const repository of repositories) {
        const qualifier = ` repo:${repository}`;
        // GitHub search limits query length to 256 characters.
        if (query.length + qualifier.length > 256) {
            if (query === baseQuery) throw Object.assign(new Error('Search text is too long for this repository filter'), { status: 422 });
            queries.push(query);
            query = baseQuery;
        }
        if (query.length + qualifier.length > 256) throw Object.assign(new Error('Search text is too long for this repository filter'), { status: 422 });
        query += qualifier;
    }
    if (query !== baseQuery) queries.push(query);
    return queries;
}

type SearchItem = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][number];

export async function searchRepositoryWorkItems(
    octokit: Pick<Octokit, 'rest'>,
    queries: string[],
    limit: number,
    cursor?: string,
    context?: WorkCacheContext,
) {
    const fingerprint = createHash('sha256').update(JSON.stringify(queries)).digest('hex');
    let offsets = queries.map(() => 0);
    if (cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
            if (decoded.fingerprint !== fingerprint || !Array.isArray(decoded.offsets)
                || decoded.offsets.length !== queries.length
                || !decoded.offsets.every((offset: unknown) => Number.isSafeInteger(offset) && (offset as number) >= 0 && (offset as number) <= 1000)) {
                throw new Error('Invalid cursor');
            }
            offsets = decoded.offsets;
        } catch {
            throw Object.assign(new Error('Repository scope or filters changed; refresh the list'), { status: 422 });
        }
    }

    const candidates: { item: SearchItem; group: number }[] = [];
    const totals = queries.map(() => 0);
    // Bound request concurrency; each disjoint repository group is a sorted stream.
    for (let start = 0; start < queries.length; start += 4) {
        await Promise.all(queries.slice(start, start + 4).map(async (q, index) => {
            const group = start + index;
            const offset = offsets[group];
            const page = Math.min(Math.floor(offset / 100) + 1, 10);
            const fetchPage = async (page: number): Promise<SearchItem[]> => {
                const load = async () => {
                    const start = performance.now();
                    if (context) context.metrics.searchRequests++;
                    try {
                        const { data } = await octokit.rest.search.issuesAndPullRequests({ q, sort: 'updated', order: 'desc', per_page: 100, page });
                        if (data.incomplete_results) throw new Error('GitHub returned incomplete search results; retry the request');
                        return data;
                    } finally {
                        if (context) context.metrics.searchRequestMs += performance.now() - start;
                    }
                };
                const data = context
                    ? await githubWorkCache.get(context.scope, JSON.stringify([fingerprint, q, page]), 30_000, load,
                        () => { context.metrics.searchCacheHits++; })
                    : await load();
                totals[group] = data.total_count;
                return data.items;
            };
            const items = (await fetchPage(page)).slice(offset - (page - 1) * 100);
            if (items.length < limit && page < 10 && page * 100 < totals[group]) {
                items.push(...await fetchPage(page + 1));
            }
            candidates.push(...items.slice(0, limit).map((item) => ({ item, group })));
        }));
    }
    // Preserve GitHub's order within each stream, including equal timestamps.
    candidates.sort((a, b) => b.item.updated_at.localeCompare(a.item.updated_at) || a.group - b.group);
    const selected = candidates.slice(0, limit);
    selected.forEach(({ group }) => offsets[group]++);
    const hasMore = totals.some((total, group) => offsets[group] < Math.min(total, 1000));
    return {
        items: selected.map(({ item }) => item),
        totalCount: totals.reduce((sum, total) => sum + total, 0),
        hasMore,
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ fingerprint, offsets })).toString('base64url') : null,
    };
}

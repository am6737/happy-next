import type { AuthCredentials } from '@/auth/tokenStorage';
import type { GithubIssueScope, GithubPullScope } from '../apiGithubData';
import { GithubError, githubCached, githubGraphql, githubJson, githubSession, type GithubSession } from './client';
import { REPOSITORY_AFFILIATIONS, mapIssue, mapPull, pageSize, type Connection, type RestIssue } from './reads';

export type WorkOptions = {
    type: 'issues' | 'pulls'; state?: 'open' | 'closed' | 'merged' | 'all';
    scope?: GithubIssueScope | GithubPullScope; repository?: string; search?: string;
    cursor?: string; limit?: number; refresh?: boolean;
};

export async function workRepositories(session: GithubSession): Promise<string[]> {
    return githubCached(session, 'work-repositories', 60_000, async () => {
        const repositories = new Set<string>();
        let cursor: string | null = null;
        do {
            const data: { viewer: { repositories: Connection<{ nameWithOwner: string }> } } = await githubGraphql(session,
                `query($cursor: String) { viewer {
                    repositories(first: 100, after: $cursor, affiliations: ${REPOSITORY_AFFILIATIONS}) {
                        nodes { nameWithOwner } pageInfo { hasNextPage endCursor }
                    }
                } }`, { cursor });
            const connection = data.viewer.repositories;
            connection.nodes.forEach((repo) => repositories.add(repo.nameWithOwner));
            const next = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
            if (connection.pageInfo.hasNextPage && (!next || next === cursor)) throw new GithubError('Invalid repository cursor', 502, 'invalid_response');
            cursor = next;
        } while (cursor);
        return [...repositories].sort();
    });
}

export function workQueries(options: WorkOptions, repositories: string[]): string[] {
    const qualifiers = [options.type === 'issues' ? 'is:issue' : 'is:pr'];
    const state = options.state ?? 'open';
    if (state === 'open') qualifiers.push('is:open');
    if (state === 'closed') {
        qualifiers.push('is:closed');
        if (options.type === 'pulls') qualifiers.push('is:unmerged');
    }
    if (state === 'merged') qualifiers.push('is:merged');
    if (options.scope === 'assigned') qualifiers.push('assignee:@me');
    if (options.scope === 'created') qualifiers.push('author:@me');
    if (options.scope === 'review-requested') qualifiers.push('review-requested:@me');
    if ((options.search?.length ?? 0) > 200) throw new GithubError('Search text too long', 422, 'invalid_search');
    const search = options.search?.replace(/["\\]/g, ' ').trim();
    if (search) qualifiers.unshift(`"${search}" in:title`);
    const base = qualifiers.join(' ');
    const queries: string[] = [];
    let query = base;
    for (const repository of repositories) {
        const qualifier = ` repo:${repository}`;
        if (query.length + qualifier.length > 256) {
            if (query !== base) queries.push(query);
            query = base;
        }
        if (query.length + qualifier.length > 256) throw new GithubError('Search text too long for repository filter', 422, 'invalid_search');
        query += qualifier;
    }
    if (query !== base) queries.push(query);
    return queries;
}

export async function searchWork(session: GithubSession, queries: string[], limit: number, cursor?: string) {
    pageSize(limit);
    let offsets: number[] = queries.map(() => 0);
    if (cursor) {
        try {
            const decoded = JSON.parse(cursor);
            if (decoded.version !== 1 || JSON.stringify(decoded.queries) !== JSON.stringify(queries)
                || !Array.isArray(decoded.offsets) || decoded.offsets.length !== queries.length
                || !decoded.offsets.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1000)) throw new Error();
            offsets = decoded.offsets;
        } catch {
            throw new GithubError('Repository scope or filters changed; refresh the list', 422, 'invalid_pagination');
        }
    }
    const totals = queries.map(() => 0);
    const candidates: { item: RestIssue; group: number }[] = [];
    for (let start = 0; start < queries.length; start += 4) {
        await Promise.all(queries.slice(start, start + 4).map(async (q, index) => {
            const group = start + index;
            const offset = offsets[group];
            const page = Math.min(Math.floor(offset / 100) + 1, 10);
            const fetchPage = async (page: number) => {
                const data = await githubCached(session, `work-search:${JSON.stringify([q, page])}`, 30_000, async () => {
                    const params = new URLSearchParams({ q, sort: 'updated', order: 'desc', per_page: '100', page: String(page) });
                    const result = await githubJson<{ items: RestIssue[]; total_count: number; incomplete_results: boolean }>(session, `/search/issues?${params}`);
                    if (result.incomplete_results) throw new GithubError('Incomplete GitHub search results; retry', 502, 'incomplete_results');
                    return result;
                });
                totals[group] = data.total_count;
                return data.items;
            };
            const items = (await fetchPage(page)).slice(offset - (page - 1) * 100);
            if (items.length < limit && page < 10 && page * 100 < totals[group]) items.push(...await fetchPage(page + 1));
            candidates.push(...items.slice(0, limit).map((item) => ({ item, group })));
        }));
    }
    candidates.sort((a, b) => b.item.updated_at.localeCompare(a.item.updated_at) || a.group - b.group);
    const selected = candidates.slice(0, limit);
    selected.forEach(({ group }) => offsets[group]++);
    const hasMore = totals.some((total, group) => offsets[group] < Math.min(total, 1000));
    return { items: selected.map(({ item }) => item), totalCount: totals.reduce((a, b) => a + b, 0), hasMore,
        nextCursor: hasMore ? JSON.stringify({ version: 1, queries, offsets }) : null };
}

export async function readWork(credentials: AuthCredentials, options: WorkOptions) {
    const session = githubSession(credentials);
    if (options.refresh && !options.cursor) {
        for (const key of session.cache.keys()) if (key.startsWith('work-search:')) session.cache.delete(key);
    }
    const repositories = await workRepositories(session);
    const allowed = options.repository ? repositories.filter((r) => r.toLowerCase() === options.repository!.toLowerCase()) : repositories;
    return searchWork(session, workQueries(options, allowed), pageSize(options.limit), options.cursor);
}

export async function readWorkIssues(credentials: AuthCredentials, options: Omit<WorkOptions, 'type' | 'scope' | 'state'> & {
    scope?: GithubIssueScope; state?: 'open' | 'closed' | 'all';
}) {
    const result = await readWork(credentials, { ...options, type: 'issues' });
    return { ...result, items: result.items.map(mapIssue) };
}

export async function readWorkPulls(credentials: AuthCredentials, options: Omit<WorkOptions, 'type' | 'scope'> & { scope?: GithubPullScope }) {
    const result = await readWork(credentials, { ...options, type: 'pulls' });
    return { ...result, items: result.items.map(mapPull) };
}

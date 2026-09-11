import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearGithubSession, githubGraphql, githubJson, githubSession } from './client';
import { readWork, searchWork, workQueries, workRepositories } from './workItems';

vi.mock('../serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), githubJson: vi.fn(), githubGraphql: vi.fn() }));
const credentials = { token: 'happy', secret: 'secret' };
beforeEach(() => { clearGithubSession(); vi.resetAllMocks(); });
afterEach(() => { clearGithubSession(); });
const item = (number: number) => ({ number, title: 'issue', state: 'open', created_at: '', updated_at: new Date(1700000000000 - number * 1000).toISOString() });

test('shares and paginates the affiliated repository directory', async () => {
    vi.mocked(githubGraphql).mockResolvedValueOnce({ viewer: { repositories: { nodes: [{ nameWithOwner: 'org/one' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } });
    vi.mocked(githubGraphql).mockResolvedValueOnce({ viewer: { repositories: { nodes: [{ nameWithOwner: 'org/two' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    const session = githubSession(credentials);
    const results = await Promise.all([workRepositories(session), workRepositories(session)]);
    expect(results).toEqual([['org/one', 'org/two'], ['org/one', 'org/two']]);
    expect(githubGraphql).toHaveBeenCalledTimes(2);
    expect(vi.mocked(githubGraphql).mock.calls[1][2]).toEqual({ cursor: 'next' });
});

test('splits search groups without widening repository scope', () => {
    const repos = Array.from({ length: 50 }, (_, i) => `org/repository-${i}`);
    const queries = workQueries({ type: 'pulls', state: 'closed', scope: 'created' }, repos);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every((q) => q.length <= 256 && q.startsWith('is:pr is:closed is:unmerged author:@me'))).toBe(true);
    expect(queries.flatMap((q) => q.match(/repo:[^ ]+/g) ?? [])).toEqual(repos.map((r) => `repo:${r}`));
    expect(workQueries({ type: 'issues' }, [])).toEqual([]);
});

test('merges sorted groups and resumes across pages without omissions', async () => {
    const groups = { one: Array.from({ length: 135 }, (_, i) => item(i * 2)), two: Array.from({ length: 130 }, (_, i) => item(i * 2 + 1)) };
    vi.mocked(githubJson).mockImplementation(async (_session, path) => {
        const params = new URL(path, 'https://api.github.com').searchParams;
        const list = groups[params.get('q') as keyof typeof groups];
        const page = Number(params.get('page'));
        return { items: list.slice((page - 1) * 100, page * 100), total_count: list.length, incomplete_results: false };
    });
    const session = githubSession(credentials);
    let cursor: string | undefined;
    const collected: number[] = [];
    do {
        const page = await searchWork(session, ['one', 'two'], 30, cursor);
        collected.push(...page.items.map((i) => i.number));
        expect(page.totalCount).toBe(265);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(collected).toEqual([...groups.one, ...groups.two].map((i) => i.number).sort((a, b) => a - b));
    expect(githubJson).toHaveBeenCalledTimes(4);
});

test('rejects cursors from different filters', async () => {
    vi.mocked(githubJson).mockResolvedValue({ items: [item(1), item(2)], total_count: 2, incomplete_results: false });
    const session = githubSession(credentials);
    const first = await searchWork(session, ['one'], 1);
    await expect(searchWork(session, ['two'], 1, first.nextCursor!)).rejects.toMatchObject({ code: 'invalid_pagination' });
});

test('refresh invalidates search pages but retains the repository directory', async () => {
    vi.mocked(githubGraphql).mockResolvedValue({ viewer: { repositories: { nodes: [{ nameWithOwner: 'org/repo' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    vi.mocked(githubJson).mockResolvedValue({ items: [], total_count: 0, incomplete_results: false });
    await readWork(credentials, { type: 'issues' });
    await readWork(credentials, { type: 'issues' });
    await readWork(credentials, { type: 'issues', refresh: true });
    expect(githubGraphql).toHaveBeenCalledTimes(1);
    expect(githubJson).toHaveBeenCalledTimes(2);
});

test('incomplete search results are rejected and never cached', async () => {
    vi.mocked(githubJson).mockResolvedValue({ items: [], total_count: 4, incomplete_results: true });
    const session = githubSession(credentials);
    await expect(searchWork(session, ['one'], 30)).rejects.toMatchObject({ code: 'incomplete_results' });
    await expect(searchWork(session, ['one'], 30)).rejects.toMatchObject({ code: 'incomplete_results' });
    expect(githubJson).toHaveBeenCalledTimes(2);
});

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readComments, readIssue, readIssues, readPull, readPulls, readRepo, readRepos } from './reads';
import { clearGithubSession } from './client';

vi.mock('../serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
const credentials = { token: 'happy', secret: 'secret' };
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers });
beforeEach(() => {
    clearGithubSession(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: 'gho_access' }));
});
afterEach(() => { clearGithubSession(); vi.unstubAllGlobals(); });

test('repository list retains affiliations, counts and GraphQL pagination', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { viewer: { repositories: {
        nodes: [{ nameWithOwner: 'org/repo', name: 'repo', issues: { totalCount: 5 }, pullRequests: { totalCount: 7 }, isPrivate: true }],
        totalCount: 42, pageInfo: { hasNextPage: true, endCursor: 'next' },
    } } } }));
    expect(await readRepos(credentials)).toMatchObject({ items: [{ fullName: 'org/repo', openIssuesCount: 5, openPRsCount: 7, isPrivate: true }], totalCount: 42, nextCursor: 'next' });
    const query = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(query.query).toContain('[OWNER, COLLABORATOR, ORGANIZATION_MEMBER]');
    expect(query.variables.first).toBe(30);
});

test('repository search stays paginated and scoped', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { search: { nodes: [], repositoryCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } } }));
    expect(await readRepos(credentials, { search: 'test', cursor: 'cursor', limit: 10 })).toMatchObject({ items: [], totalCount: 0 });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).variables).toEqual({ query: 'test in:name fork:true user:@me', cursor: 'cursor', first: 10 });
});

test('Issue connection does not overfetch and discard ten entries', async () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, state: 'OPEN', title: 'issue', createdAt: '', labels: { nodes: [] } }));
    fetchMock.mockResolvedValueOnce(json({ data: { repository: { issues: { nodes, totalCount: 40, pageInfo: { hasNextPage: true, endCursor: 'after-30' } } } } }));
    fetchMock.mockResolvedValueOnce(json({ data: { repository: { issues: { nodes: [{ ...nodes[0], number: 31 }], totalCount: 40, pageInfo: { hasNextPage: false, endCursor: null } } } } }));
    const first = await readIssues(credentials, 'org', 'repo');
    const second = await readIssues(credentials, 'org', 'repo', { cursor: first.nextCursor! });
    expect(first.items.map((i) => i.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(second.items[0].number).toBe(31);
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string).variables.cursor).toBe('after-30');
});

test('PR and comment pages use Link, not page length, to determine completion', async () => {
    fetchMock.mockResolvedValueOnce(json([{ number: 1, title: 'PR', state: 'closed', merged_at: '2026-09-10', user: null }], { link: '<https://api.github.com/x?page=2>; rel="next"' }));
    fetchMock.mockResolvedValueOnce(json([{ id: 1, body: null, user: null, author_association: 'NONE', created_at: 'now', updated_at: 'now' }]));
    expect(await readPulls(credentials, 'org', 'repo')).toMatchObject({ items: [{ status: 'merged' }], hasMore: true, nextCursor: 'page:2' });
    expect(await readComments(credentials, 'org', 'repo', 1, { limit: 1 })).toMatchObject({ items: [{ body: '', author: '' }], hasMore: false });
});

test('single Issue and PR mapping retains authors, labels and body', async () => {
    const item = { number: 1, title: 'title', body: 'body', state: 'open', user: { login: 'user', avatar_url: 'avatar' }, labels: ['bug'], head: { ref: 'feature' } };
    fetchMock.mockResolvedValueOnce(json(item)).mockResolvedValueOnce(json(item));
    expect(await readIssue(credentials, 'org', 'repo', 1)).toMatchObject({ body: 'body', author: 'user', labels: [{ name: 'bug', color: '' }] });
    expect(await readPull(credentials, 'org', 'repo', 1)).toMatchObject({ body: 'body', headRefName: 'feature', status: 'open' });
});

test('repository details preserve README, branches and selected-branch commit count', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/graphql')
        ? json({ data: { repository: { nameWithOwner: 'org/repo', name: 'repo', refs: { nodes: [{ name: 'main' }] }, object: { history: { totalCount: 12 } } } } })
        : new Response('<h1>README</h1>'));
    expect(await readRepo(credentials, 'org', 'repo', 'feature')).toMatchObject({ readme: '<h1>README</h1>', branches: ['main'], commitsCount: 12 });
    const graphql = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/graphql'))!;
    expect(JSON.parse(graphql[1]?.body as string).variables.branch).toBe('feature');
});

test('rejects malformed REST cursors and repository traversal', async () => {
    await expect(readPulls(credentials, 'org', 'repo', { cursor: 'bad' })).rejects.toMatchObject({ code: 'invalid_pagination' });
    await expect(readIssue(credentials, '..', 'repo', 1)).rejects.toMatchObject({ code: 'invalid_repository' });
    expect(fetchMock).not.toHaveBeenCalled();
});

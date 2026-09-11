import type { AuthCredentials } from '@/auth/tokenStorage';
import type { RepoInfo, RepoIssue, RepoIssueComment, RepoPR } from '@/data/mockRepos';
import type { PaginatedResponse } from '../apiGithubData';
import { GithubError, githubGraphql, githubJson, githubRequest, githubSession, type GithubSession } from './client';

export const REPOSITORY_AFFILIATIONS = '[OWNER, COLLABORATOR, ORGANIZATION_MEMBER]';
export type Connection<T> = { nodes: T[]; totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Count = { totalCount: number };
type CommitRef = { target?: { history?: Count } };
type Repository = {
    nameWithOwner: string; name: string; owner?: { login: string; avatarUrl: string };
    description?: string; primaryLanguage?: { name: string }; stargazerCount: number; forkCount: number;
    watchers: Count; issues: Count; pullRequests: Count; diskUsage: number;
    createdAt: string; pushedAt?: string; updatedAt: string; isPrivate: boolean; isFork: boolean;
    defaultBranchRef?: { name: string } & CommitRef; viewerHasStarred: boolean;
    refs?: { nodes: { name: string }[] }; object?: { history?: Count };
};
const repositoryFields = `nameWithOwner name owner { login avatarUrl } description primaryLanguage { name }
    stargazerCount forkCount watchers { totalCount } issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount } diskUsage createdAt pushedAt updatedAt isPrivate isFork
    defaultBranchRef { name } viewerHasStarred`;

function mapRepository(r: Repository): RepoInfo {
    return {
        fullName: r.nameWithOwner, name: r.name, owner: r.owner?.login ?? '', ownerAvatarUrl: r.owner?.avatarUrl ?? '',
        description: r.description ?? '', language: r.primaryLanguage?.name ?? '', stars: r.stargazerCount ?? 0,
        forks: r.forkCount ?? 0, watchers: r.watchers?.totalCount ?? 0, openIssuesCount: r.issues?.totalCount ?? 0,
        openPRsCount: r.pullRequests?.totalCount ?? 0, commitsCount: 0, repoSizeKb: r.diskUsage ?? 0,
        createdAt: r.createdAt ?? '', pushedAt: r.pushedAt ?? '', defaultBranch: r.defaultBranchRef?.name ?? 'main',
        branches: [], updatedAt: r.updatedAt ?? '', isPrivate: r.isPrivate, isFork: r.isFork ?? false,
        readme: '', viewerHasStarred: r.viewerHasStarred,
    };
}

export function pageSize(limit = 30): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GithubError('Invalid page size', 422, 'invalid_pagination');
    return limit;
}

export function connectionPage<T, R>(connection: Connection<T>, map: (item: T) => R): PaginatedResponse<R> {
    return { items: connection.nodes.filter(Boolean).map(map), totalCount: connection.totalCount,
        hasMore: connection.pageInfo.hasNextPage,
        nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null };
}

export function repositoryPath(owner: string, repo: string): string {
    if (![owner, repo].every((part) => part.trim() && !['.', '..'].includes(part) && !/[\/\\]/.test(part))) {
        throw new GithubError('Invalid repository', 422, 'invalid_repository');
    }
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function readRepos(credentials: AuthCredentials, opts: { sort?: string; cursor?: string; limit?: number; search?: string } = {}): Promise<PaginatedResponse<RepoInfo>> {
    const session = githubSession(credentials);
    const variables = { first: pageSize(opts.limit), cursor: opts.cursor ?? null };
    if (opts.search?.trim()) {
        const search = opts.search.replace(/[^\w\s\-_.]/g, '').trim();
        const result = await githubGraphql<{ search: Connection<Repository> & { repositoryCount: number } }>(session,
            `query($query: String!, $first: Int!, $cursor: String) {
                search(query: $query, type: REPOSITORY, first: $first, after: $cursor) {
                    nodes { ... on Repository { ${repositoryFields} } } repositoryCount pageInfo { hasNextPage endCursor }
                }
            }`, { ...variables, query: `${search} in:name fork:true user:@me` });
        return connectionPage({ ...result.search, totalCount: result.search.repositoryCount }, mapRepository);
    }
    const sort: Record<string, string> = { created: 'CREATED_AT', updated: 'UPDATED_AT', pushed: 'PUSHED_AT', full_name: 'NAME' };
    const result = await githubGraphql<{ viewer: { repositories: Connection<Repository> } }>(session,
        `query($first: Int!, $cursor: String, $orderBy: RepositoryOrder!) {
            viewer { repositories(first: $first, after: $cursor, orderBy: $orderBy, affiliations: ${REPOSITORY_AFFILIATIONS}) {
                nodes { ${repositoryFields} } totalCount pageInfo { hasNextPage endCursor }
            } }
        }`, { ...variables, orderBy: { field: sort[opts.sort ?? 'updated'] ?? 'UPDATED_AT', direction: opts.sort === 'full_name' ? 'ASC' : 'DESC' } });
    return connectionPage(result.viewer.repositories, mapRepository);
}

export async function readRepo(credentials: AuthCredentials, owner: string, repo: string, branch?: string): Promise<RepoInfo> {
    const session = githubSession(credentials);
    const path = repositoryPath(owner, repo);
    const [result, readme] = await Promise.all([
        githubGraphql<{ repository: Repository | null }>(session, `query($owner: String!, $repo: String!, $branch: String!) {
            repository(owner: $owner, name: $repo) { ${repositoryFields}
                refs(refPrefix: "refs/heads/", first: 30) { nodes { name } }
                object(expression: $branch) { ... on Commit { history(first: 1) { totalCount } } }
            }
        }`, { owner, repo, branch: branch ?? 'HEAD' }),
        githubRequest(session, `${path}/readme`, undefined, 'application/vnd.github.html+json').then((r) => r.text()).catch((error) => {
            if (error instanceof GithubError && [404, 409].includes(error.status)) return '';
            throw error;
        }),
    ]);
    if (!result.repository) throw new GithubError('Repository not found', 404, 'github_request_failed');
    return { ...mapRepository(result.repository), readme, branches: result.repository.refs?.nodes.map((r) => r.name) ?? [],
        commitsCount: result.repository.object?.history?.totalCount ?? 0 };
}

export type RestIssue = {
    number: number; title: string; body?: string | null; state: 'open' | 'closed';
    user?: { login: string; avatar_url: string } | null; created_at: string; updated_at: string;
    repository_url?: string; labels?: (string | { name?: string; color?: string })[];
    merged_at?: string | null; pull_request?: { merged_at?: string | null }; head?: { ref: string };
};
export function mapIssue(i: RestIssue): RepoIssue {
    return { repositoryFullName: i.repository_url?.split('/repos/')[1], number: i.number, title: i.title,
        body: i.body ?? '', state: i.state, author: i.user?.login ?? '', authorAvatarUrl: i.user?.avatar_url ?? '',
        createdAt: i.created_at, labels: (i.labels ?? []).map((l) => typeof l === 'string' ? { name: l, color: '' }
            : { name: l.name ?? '', color: l.color ?? '' }) };
}
export function mapPull(i: RestIssue): RepoPR {
    const mergedAt = i.merged_at ?? i.pull_request?.merged_at ?? undefined;
    return { repositoryFullName: i.repository_url?.split('/repos/')[1], number: i.number, title: i.title,
        body: i.body ?? undefined, status: mergedAt ? 'merged' : i.state, mergedAt,
        author: i.user?.login ?? '', authorAvatarUrl: i.user?.avatar_url ?? '', createdAt: i.created_at, headRefName: i.head?.ref };
}

export type ListOptions = { state?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number };
type GraphIssue = { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; createdAt: string;
    author?: { login: string; avatarUrl: string }; labels: { nodes: { name: string; color: string }[] } };

export async function readIssues(credentials: AuthCredentials, owner: string, repo: string, opts: ListOptions = {}): Promise<PaginatedResponse<RepoIssue>> {
    repositoryPath(owner, repo);
    const result = await githubGraphql<{ repository: { issues: Connection<GraphIssue> } | null }>(githubSession(credentials),
        `query($owner: String!, $repo: String!, $first: Int!, $cursor: String, $states: [IssueState!]) {
            repository(owner: $owner, name: $repo) {
                issues(first: $first, after: $cursor, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) {
                    nodes { number title body state createdAt author { login avatarUrl } labels(first: 100) { nodes { name color } } }
                    totalCount pageInfo { hasNextPage endCursor }
                }
            }
        }`, { owner, repo, first: pageSize(opts.limit), cursor: opts.cursor ?? null,
            states: opts.state === 'all' ? ['OPEN', 'CLOSED'] : [(opts.state ?? 'open').toUpperCase()] });
    if (!result.repository) throw new GithubError('Repository not found', 404, 'github_request_failed');
    return connectionPage(result.repository.issues, (i) => ({ number: i.number, title: i.title, body: i.body ?? '',
        state: i.state === 'OPEN' ? 'open' : 'closed', author: i.author?.login ?? '', authorAvatarUrl: i.author?.avatarUrl ?? '',
        createdAt: i.createdAt, labels: i.labels.nodes }));
}

export async function restPage<T, R>(session: GithubSession, path: string, opts: { cursor?: string; limit?: number }, map: (item: T) => R): Promise<PaginatedResponse<R>> {
    const page = opts.cursor ? Number(/^page:(\d+)$/.exec(opts.cursor)?.[1]) : 1;
    if (!Number.isSafeInteger(page) || page < 1) throw new GithubError('Invalid cursor', 422, 'invalid_pagination');
    const separator = path.includes('?') ? '&' : '?';
    const response = await githubRequest(session, `${path}${separator}page=${page}&per_page=${pageSize(opts.limit)}`);
    const items = await response.json() as T[];
    const hasMore = /rel="next"/.test(response.headers.get('link') ?? '');
    return { items: items.map(map), hasMore, nextCursor: hasMore ? `page:${page + 1}` : null };
}

export const readIssue = async (credentials: AuthCredentials, owner: string, repo: string, number: number): Promise<RepoIssue> =>
    mapIssue(await githubJson<RestIssue>(githubSession(credentials), `${repositoryPath(owner, repo)}/issues/${number}`));
export const readPull = async (credentials: AuthCredentials, owner: string, repo: string, number: number): Promise<RepoPR> =>
    mapPull(await githubJson<RestIssue>(githubSession(credentials), `${repositoryPath(owner, repo)}/pulls/${number}`));
export const readPulls = (credentials: AuthCredentials, owner: string, repo: string, opts: ListOptions = {}): Promise<PaginatedResponse<RepoPR>> =>
    restPage(githubSession(credentials), `${repositoryPath(owner, repo)}/pulls?state=${opts.state ?? 'open'}&sort=created&direction=desc`, opts, mapPull);

type Comment = { id: number; body?: string | null; user?: { login: string; avatar_url: string } | null;
    author_association: string; created_at: string; updated_at: string };
export const readComments = (credentials: AuthCredentials, owner: string, repo: string, number: number, opts: { cursor?: string; limit?: number } = {}): Promise<PaginatedResponse<RepoIssueComment>> =>
    restPage<Comment, RepoIssueComment>(githubSession(credentials), `${repositoryPath(owner, repo)}/issues/${number}/comments`, opts,
        (c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? '', authorAvatarUrl: c.user?.avatar_url ?? '',
            authorAssociation: c.author_association, createdAt: c.created_at, updatedAt: c.updated_at }));

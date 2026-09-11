import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/AuthContext';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from '@/sync/serverConfig';
import { clearGithubSession, githubRevision, onGithubReset } from '@/sync/github/client';
import {
    fetchGithubRepos,
    fetchGithubRepo,
    fetchGithubIssues,
    fetchGithubIssue,
    fetchGithubIssueComments,
    fetchGithubPulls,
    fetchGithubPull,
    fetchGithubWorkIssues,
    fetchGithubWorkPulls,
} from '@/sync/apiGithubData';
import type { GithubIssueScope, GithubPullScope, PaginatedResponse } from '@/sync/apiGithubData';
import type {
    RepoInfo,
    RepoIssue,
    RepoIssueComment,
    RepoPR,
} from '@/data/mockRepos';

const MAX_CACHE_SIZE = 100;
const dataCache = new Map<string, unknown>();
// Share requests between concurrently mounted screens/hooks. Without this,
// navigation transitions can issue the same GitHub query several times.
const inFlight = new Map<string, Promise<unknown>>();
onGithubReset(() => {
    dataCache.clear();
    inFlight.clear();
});

function cacheSet(key: string, value: unknown): void {
    if (dataCache.has(key)) {
        dataCache.delete(key);
    } else if (dataCache.size >= MAX_CACHE_SIZE) {
        const firstKey = dataCache.keys().next().value!;
        dataCache.delete(firstKey);
    }
    dataCache.set(key, value);
}

function cacheKey(deps: unknown[]): string {
    return JSON.stringify([getServerUrl(), githubRevision(), ...deps]);
}

export function clearGithubCache(): void {
    dataCache.clear();
    inFlight.clear();
    clearGithubSession();
}

function requestOnce<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
    const pending = inFlight.get(key);
    if (pending && !force) return pending as Promise<T>;

    // A forced refresh must run after an existing request for this key. This
    // prevents the older request from completing after the refresh and
    // overwriting its newer result in the shared cache.
    const promise = (pending && force
        ? pending.catch(() => undefined).then(fetcher)
        : fetcher()
    ).finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
}

function useGithubFetch<T>(
    fetcher: () => Promise<T>,
    deps: unknown[],
    initial: T,
    enabled: boolean = true
): { data: T; loading: boolean; refresh: () => void; mutate: (updater: (prev: T) => T) => void; tokenExpired: boolean } {
    useSyncExternalStore(onGithubReset, githubRevision, githubRevision);
    const key = cacheKey(deps);
    const [data, setData] = useState<T>(() => {
        const cached = dataCache.get(key);
        return cached !== undefined ? (cached as T) : initial;
    });
    const [loading, setLoading] = useState(() => enabled && !dataCache.has(key));
    const [tokenExpired, setTokenExpired] = useState(false);
    const mountedRef = useRef(true);
    const prevKeyRef = useRef(key);
    const requestIdRef = useRef(0);

    if (prevKeyRef.current !== key) {
        prevKeyRef.current = key;
        const cached = dataCache.get(key);
        if (cached !== undefined) {
            setData(cached as T);
            setLoading(false);
        } else {
            setData(initial);
            setLoading(enabled);
        }
    }

    const load = useCallback(async (force?: boolean) => {
        if (!enabled) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => mountedRef.current && prevKeyRef.current === key && requestIdRef.current === requestId;
        setTokenExpired(false);
        if (force || !dataCache.has(key)) {
            setLoading(true);
        }
        try {
            const result = await requestOnce(key, fetcher, force);
            if (isCurrent()) {
                setData(result);
                cacheSet(key, result);
                setTokenExpired(false);
            }
        } catch (e) {
            const code = (e as any)?.code;
            if (isCurrent() && (code === 'github_token_expired' || code === 'github_not_connected')) {
                setTokenExpired(true);
            }
            console.warn('[useGithubFetch] fetch failed:', e);
        } finally {
            if (isCurrent()) {
                setLoading(false);
            }
        }
    }, [key, enabled]);

    useEffect(() => {
        mountedRef.current = true;
        load();
        return () => { mountedRef.current = false; requestIdRef.current++; };
    }, [load]);

    const refresh = useCallback(() => { load(true); }, [load]);

    const keyRef = useRef(key);
    keyRef.current = key;
    const mutate = useCallback((updater: (prev: T) => T) => {
        setData((prev) => {
            const next = updater(prev);
            cacheSet(keyRef.current, next);
            return next;
        });
    }, []);

    return { data, loading, refresh, mutate, tokenExpired };
}

function useGithubPaginatedFetch<T>(
    fetcher: (cursor?: string, refresh?: boolean) => Promise<PaginatedResponse<T>>,
    deps: unknown[],
    enabled: boolean = true
): {
    data: T[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    totalCount: number | undefined;
    loadMore: () => void;
    refresh: () => Promise<void>;
    mutate: (updater: (prev: T[]) => T[]) => void;
    tokenExpired: boolean;
    error: Error | null;
} {
    useSyncExternalStore(onGithubReset, githubRevision, githubRevision);
    const key = cacheKey(deps);
    const [data, setData] = useState<T[]>(() => {
        const cached = dataCache.get(key);
        return cached !== undefined ? (cached as T[]) : [];
    });
    const [loading, setLoading] = useState(() => enabled && !dataCache.has(key));
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
    const [tokenExpired, setTokenExpired] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const mountedRef = useRef(true);
    const cursorRef = useRef<string | null>(null);
    const prevKeyRef = useRef(key);
    const loadingMoreRef = useRef(false);
    const requestIdRef = useRef(0);
    const moreIdRef = useRef(0);

    if (prevKeyRef.current !== key) {
        prevKeyRef.current = key;
        cursorRef.current = null;
        const cached = dataCache.get(key);
        if (cached !== undefined) {
            setData(cached as T[]);
            setLoading(false);
        } else {
            setData([]);
            setLoading(enabled);
        }
        setHasMore(false);
        setTotalCount(undefined);
        setError(null);
    }

    const loadFirst = useCallback(async (force?: boolean) => {
        if (!enabled) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => mountedRef.current && prevKeyRef.current === key && requestIdRef.current === requestId;
        moreIdRef.current++;
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setTokenExpired(false);
        cursorRef.current = null;
        if (force || !dataCache.has(key)) {
            setLoading(true);
        }
        setError(null);
        try {
            // Use the data key for the first page so prefetches and mounted
            // lists share the same in-flight request.
            const result = await requestOnce(key, () => fetcher(undefined, force), force);
            if (isCurrent()) {
                setData(result.items);
                cacheSet(key, result.items);
                cursorRef.current = result.nextCursor;
                setHasMore(result.hasMore);
                if (result.totalCount !== undefined) setTotalCount(result.totalCount);
                setTokenExpired(false);
            }
        } catch (e) {
            const code = (e as any)?.code;
            if (isCurrent()) {
                setError(e instanceof Error ? e : new Error(String(e)));
                if (code === 'github_token_expired' || code === 'github_not_connected') {
                    setTokenExpired(true);
                }
            }
            console.warn('[useGithubPaginatedFetch] fetch failed:', e);
        } finally {
            if (isCurrent()) {
                setLoading(false);
            }
        }
    }, [key, enabled]);

    useEffect(() => {
        mountedRef.current = true;
        loadFirst();
        return () => {
            mountedRef.current = false;
            requestIdRef.current++;
            moreIdRef.current++;
        };
    }, [loadFirst]);

    const loadMore = useCallback(() => {
        if (!enabled || loadingMoreRef.current || !cursorRef.current) return;
        const requestId = requestIdRef.current;
        const moreId = ++moreIdRef.current;
        const isCurrent = () => mountedRef.current && prevKeyRef.current === key && requestIdRef.current === requestId && moreIdRef.current === moreId;
        loadingMoreRef.current = true;
        setLoadingMore(true);

        requestOnce(`${key}:page:${cursorRef.current}`, () => fetcher(cursorRef.current!))
            .then((result) => {
                if (isCurrent()) {
                    setData((prev) => {
                        const next = [...prev, ...result.items];
                        cacheSet(key, next);
                        return next;
                    });
                    cursorRef.current = result.nextCursor;
                    setHasMore(result.hasMore);
                }
            })
            .catch((e) => {
                if (isCurrent()) {
                    setError(e instanceof Error ? e : new Error(String(e)));
                    if (e?.code === 'github_token_expired' || e?.code === 'github_not_connected') setTokenExpired(true);
                }
                console.warn('[useGithubPaginatedFetch] loadMore failed:', e);
            })
            .finally(() => {
                if (isCurrent()) {
                    loadingMoreRef.current = false;
                    setLoadingMore(false);
                }
            });
    }, [key, enabled, fetcher]);

    const refresh = useCallback(() => loadFirst(true), [loadFirst]);

    const keyRef = useRef(key);
    keyRef.current = key;
    const mutate = useCallback((updater: (prev: T[]) => T[]) => {
        setData((prev) => {
            const next = updater(prev);
            cacheSet(keyRef.current, next);
            return next;
        });
    }, []);

    return { data, loading, loadingMore, hasMore, totalCount, loadMore, refresh, mutate, tokenExpired, error };
}

export function useGithubRepos(opts?: { sort?: string; search?: string }) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoInfo>(
        (cursor) => credentials
            ? fetchGithubRepos(credentials, { sort: opts?.sort, search: opts?.search, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['repos', credentials?.token, opts?.sort, opts?.search]
    );
}

export function useGithubWorkIssues(options: {
    state?: 'open' | 'closed' | 'all';
    scope?: GithubIssueScope;
    repository?: string;
    search?: string;
    enabled?: boolean;
}) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoIssue>(
        (cursor, refresh) => credentials
            ? fetchGithubWorkIssues(credentials, { ...options, cursor, refresh })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['work-issues', credentials?.token, options.state, options.scope, options.repository, options.search],
        options.enabled ?? true
    );
}

export function useGithubWorkPulls(options: {
    state?: 'open' | 'closed' | 'merged' | 'all';
    scope?: GithubPullScope;
    repository?: string;
    search?: string;
    enabled?: boolean;
}) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoPR>(
        (cursor, refresh) => credentials
            ? fetchGithubWorkPulls(credentials, { ...options, cursor, refresh })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['work-pulls', credentials?.token, options.state, options.scope, options.repository, options.search],
        options.enabled ?? true
    );
}

function hasRepoCoordinates(owner: string | null | undefined, repo: string | null | undefined): boolean {
    return typeof owner === 'string' && owner.trim().length > 0
        && typeof repo === 'string' && repo.trim().length > 0;
}

export function useGithubRepo(owner: string, repo: string, branch?: string) {
    const { credentials } = useAuth();
    const enabled = hasRepoCoordinates(owner, repo);
    return useGithubFetch<RepoInfo | null>(
        () => credentials ? fetchGithubRepo(credentials, owner, repo, branch) : Promise.resolve(null),
        ['repo', credentials?.token, owner, repo, branch],
        null,
        enabled
    );
}

export function useGithubIssues(owner: string, repo: string, state?: 'open' | 'closed' | 'all', enabled: boolean = true) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoIssue>(
        (cursor) => credentials
            ? fetchGithubIssues(credentials, owner, repo, { state, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['issues', credentials?.token, owner, repo, state],
        enabled && hasRepoCoordinates(owner, repo)
    );
}

export function useGithubIssue(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    const enabled = hasRepoCoordinates(owner, repo) && Number.isInteger(number) && number > 0;
    return useGithubFetch<RepoIssue | null>(
        () => credentials ? fetchGithubIssue(credentials, owner, repo, number) : Promise.resolve(null),
        ['issue', credentials?.token, owner, repo, number],
        null,
        enabled
    );
}

export function useGithubIssueComments(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoIssueComment>(
        (cursor) => credentials
            ? fetchGithubIssueComments(credentials, owner, repo, number, { cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['issue-comments', credentials?.token, owner, repo, number],
        hasRepoCoordinates(owner, repo) && Number.isInteger(number) && number > 0
    );
}

export function useGithubPulls(owner: string, repo: string, state?: 'open' | 'closed' | 'all', enabled: boolean = true) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoPR>(
        (cursor) => credentials
            ? fetchGithubPulls(credentials, owner, repo, { state, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['pulls', credentials?.token, owner, repo, state],
        enabled && hasRepoCoordinates(owner, repo)
    );
}

export function useGithubPull(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    const enabled = hasRepoCoordinates(owner, repo) && Number.isInteger(number) && number > 0;
    return useGithubFetch<RepoPR | null>(
        () => credentials ? fetchGithubPull(credentials, owner, repo, number) : Promise.resolve(null),
        ['pull', credentials?.token, owner, repo, number],
        null,
        enabled
    );
}

// Prefetch repos + open issues/PRs for the first repo to warm the cache
// before the GitHub tab is opened. Called from MainView on mount.

let prefetchInFlight = false;

export async function prefetchGithubData(credentials: AuthCredentials): Promise<void> {
    if (prefetchInFlight) return;
    prefetchInFlight = true;
    try {
        const reposKey = cacheKey(['repos', credentials.token, undefined, undefined]);
        if (!dataCache.has(reposKey)) {
            // Keep the prefetch on the same key as useGithubRepos so an
            // already-mounted list can share its in-flight request.
            const result = await requestOnce(reposKey, () => fetchGithubRepos(credentials));
            cacheSet(reposKey, result.items);
        }
        const repos = dataCache.get(reposKey) as RepoInfo[];

        if (repos && repos.length > 0) {
            const { fullName } = repos[0];
            const [owner, repo] = fullName.split('/');
            if (!owner || !repo) return;
            const issuesKey = cacheKey(['issues', credentials.token, owner, repo, 'open']);
            const pullsKey = cacheKey(['pulls', credentials.token, owner, repo, 'open']);
            const pending: Promise<void>[] = [];
            if (!dataCache.has(issuesKey)) {
                pending.push(
                    requestOnce(
                        `${issuesKey}:first`,
                        () => fetchGithubIssues(credentials, owner, repo, { state: 'open' })
                    )
                        .then((d) => { cacheSet(issuesKey, d.items); })
                );
            }
            if (!dataCache.has(pullsKey)) {
                pending.push(
                    requestOnce(
                        `${pullsKey}:first`,
                        () => fetchGithubPulls(credentials, owner, repo, { state: 'open' })
                    )
                        .then((d) => { cacheSet(pullsKey, d.items); })
                );
            }
            await Promise.all(pending);
        }
    } catch (e) {
        console.warn('[prefetchGithubData] failed:', e);
    } finally {
        prefetchInFlight = false;
    }
}

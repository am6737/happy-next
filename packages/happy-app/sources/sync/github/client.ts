import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from '../serverConfig';

export class GithubError extends Error {
    constructor(message: string, public status: number, public code: string, public retryAt?: number) {
        super(message);
    }
}

type Token = { token: string; validUntil: number };
export type GithubSession = {
    key: string;
    server: string;
    credentials: AuthCredentials;
    controller: AbortController;
    token?: Token;
    pendingToken?: Promise<string>;
    pendingRejectedToken?: string;
    cache: Map<string, { promise: Promise<unknown>; expiresAt: number; bytes: number }>;
};
let activeSession: GithubSession | undefined;
let revision = 0;
const resetListeners = new Set<() => void>();

export function githubRevision(): number { return revision; }

export function onGithubReset(listener: () => void): () => void {
    resetListeners.add(listener);
    return () => { resetListeners.delete(listener); };
}

export function clearGithubSession(): void {
    activeSession?.controller.abort();
    activeSession?.cache.clear();
    if (activeSession) activeSession.token = undefined;
    activeSession = undefined;
    revision++;
    resetListeners.forEach((listener) => listener());
}

export function invalidateGithubReads(credentials: AuthCredentials): void {
    if (activeSession?.key !== JSON.stringify([getServerUrl().replace(/\/$/, ''), credentials.token])) return;
    for (const key of activeSession.cache.keys()) if (key.startsWith('work-search:')) activeSession.cache.delete(key);
    revision++;
    resetListeners.forEach((listener) => listener());
}

export function githubSession(credentials: AuthCredentials): GithubSession {
    const server = getServerUrl().replace(/\/$/, '');
    const key = JSON.stringify([server, credentials.token]);
    if (activeSession?.key !== key) {
        if (activeSession) clearGithubSession();
        activeSession = { key, server, credentials, controller: new AbortController(), cache: new Map() };
    }
    return activeSession;
}

function assertActive(session: GithubSession): void {
    if (session !== activeSession || session.controller.signal.aborted
        || session.server !== getServerUrl().replace(/\/$/, '')) {
        throw Object.assign(new Error('GitHub request cancelled'), { name: 'AbortError' });
    }
}

async function request(session: GithubSession, url: string, init: RequestInit): Promise<Response> {
    assertActive(session);
    const controller = new AbortController();
    const abort = () => controller.abort();
    session.controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 30_000);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' });
        assertActive(session);
        // Consume the body inside the timeout, including slow/stalled downloads.
        const body = await response.text();
        assertActive(session);
        return new Response(response.status === 204 ? null : body, {
            status: response.status, headers: response.headers,
        });
    } finally {
        clearTimeout(timeout);
        session.controller.signal.removeEventListener('abort', abort);
    }
}

export async function githubToken(session: GithubSession, rejectedToken?: string): Promise<string> {
    assertActive(session);
    if (session.pendingToken) {
        const refreshing = session.pendingRejectedToken !== undefined;
        const token = await session.pendingToken;
        if (rejectedToken === token && !refreshing) return githubToken(session, rejectedToken);
        return token;
    }
    if (session.token && (rejectedToken ? session.token.token !== rejectedToken : session.token.validUntil > Date.now())) {
        return session.token.token;
    }
    const pending = (async () => {
        const response = await request(session, `${session.server}/v1/connect/github/token${rejectedToken ? '/refresh' : ''}`, {
            method: rejectedToken ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${session.credentials.token}`, 'Content-Type': 'application/json' },
            ...(rejectedToken ? { body: JSON.stringify({ previousToken: rejectedToken }) } : {}),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            session.token = undefined;
            const code = response.status === 404 ? (rejectedToken && body.error !== 'github_not_connected'
                ? 'github_server_upgrade_required' : 'github_not_connected')
                : body.error === 'github_token_expired' ? 'github_token_expired' : 'github_authorization_failed';
            throw new GithubError('GitHub authorization failed', response.status, code);
        }
        if (typeof body.token !== 'string' || !body.token) throw new GithubError('Invalid GitHub authorization response', 502, 'invalid_response');
        const expiry = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) - 60_000 : Infinity;
        assertActive(session);
        session.token = { token: body.token, validUntil: Math.min(Date.now() + 60_000, Number.isFinite(expiry) ? expiry : Infinity) };
        return body.token as string;
    })();
    session.pendingToken = pending;
    session.pendingRejectedToken = rejectedToken;
    try {
        return await pending;
    } finally {
        if (session.pendingToken === pending) {
            session.pendingToken = undefined;
            session.pendingRejectedToken = undefined;
        }
    }
}

export async function githubRequest(session: GithubSession, path: string, query?: { query: string; variables?: Record<string, unknown> }, accept = 'application/vnd.github+json'): Promise<Response> {
    const url = new URL(path, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com' || !path.startsWith('/') || url.username || url.password) {
        throw new Error('Invalid GitHub API destination');
    }
    if (query && url.pathname !== '/graphql') throw new Error('Only read-only GraphQL requests are supported');
    let token = await githubToken(session);
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(session, url.toString(), {
            method: query ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
                ...(query ? { 'Content-Type': 'application/json' } : {}) },
            ...(query ? { body: JSON.stringify(query) } : {}),
        });
        if (response.status === 401 && attempt === 0) {
            token = await githubToken(session, token);
            continue;
        }
        if (response.ok) return response;
        if (response.status === 401) session.token = undefined;
        const retryAfter = response.headers.get('retry-after');
        const limited = response.status === 429 || (response.status === 403
            && (response.headers.get('x-ratelimit-remaining') === '0' || retryAfter !== null));
        const retryAt = retryAfter ? (/^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter))
            : Number(response.headers.get('x-ratelimit-reset')) * 1000;
        throw new GithubError(limited ? 'GitHub rate limit exceeded' : `GitHub request failed: ${response.status}`,
            response.status, limited ? 'rate_limited' : response.status === 401 ? 'github_token_expired'
                : response.status === 403 ? 'github_access_denied' : 'github_request_failed',
            limited && Number.isFinite(retryAt) && retryAt > 0 ? retryAt : undefined);
    }
    throw new GithubError('GitHub authorization expired', 401, 'github_token_expired');
}

export async function githubJson<T>(session: GithubSession, path: string): Promise<T> {
    return (await githubRequest(session, path)).json() as Promise<T>;
}

export async function githubGraphql<T>(session: GithubSession, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await githubRequest(session, '/graphql', { query, variables });
    const body = await response.json();
    if (body.errors?.length || !body.data) {
        const limited = body.errors?.some((error: { type?: string }) => error.type === 'RATE_LIMITED');
        throw new GithubError('GitHub GraphQL query failed', limited ? 429 : 502, limited ? 'rate_limited' : 'github_query_failed');
    }
    return body.data as T;
}

export async function githubCached<T>(session: GithubSession, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    assertActive(session);
    const cached = session.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;
    session.cache.delete(key);
    while (session.cache.size >= 100) session.cache.delete(session.cache.keys().next().value!);
    const entry = { promise: Promise.resolve() as Promise<unknown>, expiresAt: Infinity, bytes: 0 };
    entry.promise = Promise.resolve().then(load).then((value) => {
        assertActive(session);
        entry.expiresAt = Date.now() + ttl;
        entry.bytes = JSON.stringify(value).length * 2;
        let bytes = [...session.cache.values()].reduce((total, value) => total + value.bytes, 0);
        while (bytes > 16 * 1024 * 1024 && session.cache.size) {
            const oldest = session.cache.keys().next().value!;
            bytes -= session.cache.get(oldest)!.bytes;
            session.cache.delete(oldest);
        }
        return value;
    }).catch((error) => {
        if (session.cache.get(key) === entry) session.cache.delete(key);
        throw error;
    });
    session.cache.set(key, entry);
    return entry.promise as Promise<T>;
}

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearGithubSession, githubGraphql, githubJson, githubRequest, githubSession, githubToken } from './client';

const config = vi.hoisted(() => ({ server: 'https://happy.test' }));
vi.mock('../serverConfig', () => ({ getServerUrl: () => config.server }));
const credentials = { token: 'happy-token', secret: 'secret' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
    clearGithubSession();
    config.server = 'https://happy.test';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { clearGithubSession(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('GitHub direct authorization', () => {
    test('shares token acquisition and never sends Happy credentials to GitHub', async () => {
        fetchMock.mockImplementation(async (url) => String(url).startsWith(config.server) ? json({ token: 'gho_access' }) : json({ ok: true }));
        const session = githubSession(credentials);
        await Promise.all([githubJson(session, '/user'), githubJson(session, '/user/repos')]);
        const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(config.server));
        expect(authCalls).toHaveLength(1);
        expect(authCalls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer happy-token' });
        for (const [, init] of fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.github.com'))) {
            expect(init?.headers).toMatchObject({ Authorization: 'Bearer gho_access' });
            expect(init?.redirect).toBe('error');
        }
    });

    test('merges concurrent 401 refreshes and retries each read only once', async () => {
        fetchMock.mockImplementation(async (url, init) => {
            if (String(url).endsWith('/token/refresh')) return json({ token: 'gho_new' });
            if (String(url).endsWith('/token')) return json({ token: 'gho_old' });
            return (init?.headers as Record<string, string>).Authorization === 'Bearer gho_old' ? json({}, 401) : json({ ok: true });
        });
        const session = githubSession(credentials);
        await Promise.all([githubJson(session, '/user'), githubJson(session, '/user/repos')]);
        const refreshes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/token/refresh'));
        expect(refreshes).toHaveLength(1);
        expect(JSON.parse(refreshes[0][1]?.body as string)).toEqual({ previousToken: 'gho_old' });
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    test('stops after a second 401 and does not cache the rejected token', async () => {
        fetchMock.mockImplementation(async (url) => String(url).startsWith(config.server) ? json({ token: 'gho_bad' }) : json({}, 401));
        const session = githubSession(credentials);
        await expect(githubJson(session, '/user')).rejects.toMatchObject({ code: 'github_token_expired' });
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(session.token).toBeUndefined();
    });

    test('revalidates cached access tokens and honors expiration', async () => {
        vi.useFakeTimers();
        const expiresAt = new Date(Date.now() + 90_000).toISOString();
        fetchMock.mockImplementation(async () => json({ token: 'gho_access', expiresAt }));
        const session = githubSession(credentials);
        await githubToken(session);
        await githubToken(session);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(31_000);
        await githubToken(session);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test.each([['other-account', 'https://happy.test'], ['happy-token', 'https://other.test']])('isolates account/server changes: %s %s', async (token, server) => {
        fetchMock.mockImplementation(async () => json({ token: 'gho_access' }));
        const old = githubSession(credentials);
        await githubToken(old);
        config.server = server;
        await githubToken(githubSession({ ...credentials, token }));
        expect(old.controller.signal.aborted).toBe(true);
        await expect(githubToken(old)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('discarded in-flight authorization cannot repopulate a cleared session', async () => {
        let resolve!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        const session = githubSession(credentials);
        const pending = githubToken(session);
        clearGithubSession();
        resolve(json({ token: 'gho_access' }));
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(session.token).toBeUndefined();
    });

    test('rejects foreign destinations before obtaining credentials', async () => {
        await expect(githubRequest(githubSession(credentials), '//evil.test/user')).rejects.toThrow('destination');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each([
        [403, {}, 'github_access_denied'],
        [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' }, 'rate_limited'],
        [429, { 'retry-after': '10' }, 'rate_limited'],
    ] as const)('maps HTTP %s without retry loops', async (status, headers, code) => {
        fetchMock.mockResolvedValueOnce(json({ token: 'gho_access' })).mockResolvedValueOnce(json({}, status, headers));
        await expect(githubJson(githubSession(credentials), '/user')).rejects.toMatchObject({ status, code });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('does not accept partial GraphQL success', async () => {
        fetchMock.mockResolvedValueOnce(json({ token: 'gho_access' })).mockResolvedValueOnce(json({ data: { viewer: null }, errors: [{ type: 'FORBIDDEN' }] }));
        await expect(githubGraphql(githubSession(credentials), '{ viewer { login } }')).rejects.toMatchObject({ code: 'github_query_failed' });
    });
});

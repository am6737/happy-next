import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectRoutes } from './connectRoutes';
import { auth } from '@/app/auth/auth';
import { githubConnect } from '@/app/github/githubConnect';
import { getUserGithubToken } from '@/app/github/githubApi';
import { GitHubReauthorizationRequiredError } from '@/app/github/githubOAuth';

vi.mock('@/app/auth/auth', () => ({ auth: { createGithubToken: vi.fn(), verifyGithubToken: vi.fn() } }));
vi.mock('@/app/github/githubConnect', () => ({ githubConnect: vi.fn() }));
vi.mock('@/app/github/githubDisconnect', () => ({ githubDisconnect: vi.fn() }));
vi.mock('@/app/github/githubApi', () => ({ getUserGithubToken: vi.fn(), GitHubNotConnectedError: class extends Error {} }));
vi.mock('@/storage/db', () => ({ db: {} }));
vi.mock('@/modules/encrypt', () => ({ decryptString: vi.fn(), encryptString: vi.fn() }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

describe('GitHub OAuth App connection routes', () => {
    const handlers = new Map<string, any>();
    const reply = { send: vi.fn(), code: vi.fn().mockReturnThis(), redirect: vi.fn() };
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('GITHUB_CLIENT_ID', 'oauth-client');
        vi.stubEnv('GITHUB_CLIENT_SECRET', 'oauth-secret');
        vi.stubEnv('GITHUB_REDIRECT_URL', 'https://api.example.com/v1/connect/github/callback');
        vi.stubEnv('APP_URL', 'https://app.example.com');
        vi.mocked(auth.createGithubToken).mockResolvedValue('state');
        vi.mocked(auth.verifyGithubToken).mockResolvedValue({ userId: 'user' } as any);
        connectRoutes({
            authenticate: vi.fn(), addContentTypeParser: vi.fn(),
            get: (path: string, _opts: unknown, handler: unknown) => handlers.set(path, handler),
            post: vi.fn(), delete: vi.fn(),
        } as any);
    });

    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    test('requests repository scopes without Codespaces', async () => {
        await handlers.get('/v1/connect/github/params')({ userId: 'user', query: {} }, reply);
        const url = new URL(reply.send.mock.calls[0][0].url);
        expect(url.searchParams.get('client_id')).toBe('oauth-client');
        expect(url.searchParams.get('scope')).toBe('read:user,user:email,read:org,repo');
        expect(url.searchParams.get('state')).toBe('state');
    });

    test('requires the OAuth client secret before starting authorization', async () => {
        vi.stubEnv('GITHUB_CLIENT_SECRET', '');
        await handlers.get('/v1/connect/github/params')({ userId: 'user', query: {} }, reply);
        expect(reply.code).toHaveBeenCalledWith(400);
        expect(auth.createGithubToken).not.toHaveBeenCalled();
    });

    test.each(['ghu_app', 'ghs_installation', undefined])('rejects a non-OAuth response before connecting: %s', async (token) => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: token }) });
        await handlers.get('/v1/connect/github/callback')({ query: { code: 'code', state: 'state' } }, reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://app.example.com?error=github_oauth_app_required');
        expect(githubConnect).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('connects an OAuth user without refresh metadata', async () => {
        const profile = { id: 123, login: 'user' };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gho_user' }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => profile });
        await handlers.get('/v1/connect/github/callback')({ query: { code: 'code', state: 'state' } }, reply);
        expect(githubConnect).toHaveBeenCalledWith(expect.anything(), profile, 'gho_user', {
            refreshToken: undefined, expiresIn: undefined,
        });
        expect(reply.redirect).toHaveBeenCalledWith('https://app.example.com?github=connected&user=user');
    });

    test('passes expiring OAuth credentials to account persistence', async () => {
        const profile = { id: 123, login: 'user' };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({
            access_token: 'gho_user', refresh_token: 'refresh-secret', expires_in: 28800,
        }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => profile });
        await handlers.get('/v1/connect/github/callback')({ query: { code: 'code', state: 'state' } }, reply);
        expect(githubConnect).toHaveBeenCalledWith(expect.anything(), profile, 'gho_user', {
            refreshToken: 'refresh-secret', expiresIn: 28800,
        });
    });

    test('does not expose an old GitHub App token to AI sessions', async () => {
        vi.mocked(getUserGithubToken).mockRejectedValueOnce(new GitHubReauthorizationRequiredError());
        await handlers.get('/v1/connect/github/token')({ userId: 'user' }, reply);
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith({ error: 'github_token_expired' });
    });
});

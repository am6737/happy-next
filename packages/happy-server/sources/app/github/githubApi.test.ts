import { beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '@/storage/db';
import { decryptString } from '@/modules/encrypt';
import { getUserGithubToken, getUserOctokit, GitHubNotConnectedError } from './githubApi';
import { GitHubReauthorizationRequiredError } from './githubOAuth';
import { refreshGithubToken } from './githubTokenRefresh';

vi.mock('@/storage/db', () => ({ db: { account: { findUniqueOrThrow: vi.fn() } } }));
vi.mock('@/modules/encrypt', () => ({ decryptString: vi.fn() }));
vi.mock('./githubTokenRefresh', () => ({ refreshGithubToken: vi.fn() }));

describe('OAuth App credentials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({
            githubUser: { token: Buffer.from('encrypted') },
        } as any);
    });

    test('uses the OAuth token without refresh metadata', async () => {
        vi.mocked(decryptString).mockReturnValue('gho_user');
        const octokit = await getUserOctokit('user');
        expect(await octokit.auth()).toMatchObject({ token: 'gho_user' });
        expect(db.account.findUniqueOrThrow).toHaveBeenCalledWith({
            where: { id: 'user' }, select: { githubUser: { select: { token: true, expiresAt: true } } },
        });
        expect(decryptString).toHaveBeenCalledWith(['user', 'user', 'github', 'token'], Buffer.from('encrypted'));
    });

    test('refreshes before returning a near-expiry token to API or AI callers', async () => {
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({ githubUser: {
            token: Buffer.from('encrypted'), expiresAt: new Date(Date.now() + 60_000),
        } } as any);
        vi.mocked(decryptString).mockReturnValue('gho_old');
        vi.mocked(refreshGithubToken).mockResolvedValue('gho_new');
        expect(await getUserGithubToken('user')).toBe('gho_new');
        expect(refreshGithubToken).toHaveBeenCalledWith('user', 'gho_old');
    });

    test('retries a 401 once and uses the refreshed token on subsequent requests', async () => {
        vi.mocked(decryptString).mockReturnValue('gho_old');
        vi.mocked(refreshGithubToken).mockResolvedValue('gho_new');
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))
            .mockImplementation(async () => new Response('{}', { status: 200 }));
        const octokit = await getUserOctokit('user');
        await octokit.request('GET /user', { request: { fetch } });
        await octokit.request('GET /user', { request: { fetch } });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][1].headers.authorization).toBe('token gho_old');
        expect(fetch.mock.calls[1][1].headers.authorization).toBe('token gho_new');
        expect(fetch.mock.calls[2][1].headers.authorization).toBe('token gho_new');
        expect(refreshGithubToken).toHaveBeenCalledTimes(1);
    });

    test('stops if the refreshed token also receives 401', async () => {
        vi.mocked(decryptString).mockReturnValue('gho_old');
        vi.mocked(refreshGithubToken).mockResolvedValue('gho_new');
        const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
        const octokit = await getUserOctokit('user');
        await expect(octokit.request('GET /user', { request: { fetch } })).rejects.toMatchObject({ status: 401 });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(refreshGithubToken).toHaveBeenCalledTimes(1);
    });

    test.each(['ghu_app', 'ghs_installation', 'ghp_pat', 'github_pat_test', '', 'legacy-token'])(
        'requires reauthorization instead of returning %s', async (token) => {
            vi.mocked(decryptString).mockReturnValue(token);
            await expect(getUserGithubToken('user')).rejects.toBeInstanceOf(GitHubReauthorizationRequiredError);
            await expect(getUserOctokit('user')).rejects.toMatchObject({ status: 401 });
        },
    );

    test.each([null, { token: null }])('handles a missing connection', async (githubUser) => {
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({ githubUser } as any);
        await expect(getUserGithubToken('user')).rejects.toBeInstanceOf(GitHubNotConnectedError);
    });
});

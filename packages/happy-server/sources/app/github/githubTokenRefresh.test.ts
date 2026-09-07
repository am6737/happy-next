import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '@/storage/db';
import { refreshGithubToken } from './githubTokenRefresh';

vi.mock('@/storage/db', () => ({ db: {
    account: { findUniqueOrThrow: vi.fn() }, githubUser: { updateMany: vi.fn() },
} }));
vi.mock('@/modules/encrypt', () => ({
    decryptString: (_path: string[], value: Buffer) => value.toString(),
    encryptString: (_path: string[], value: string) => Buffer.from(value),
}));

describe('OAuth token refresh', () => {
    const fetch = vi.fn();
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', fetch);
        vi.stubEnv('GITHUB_CLIENT_ID', 'client');
        vi.stubEnv('GITHUB_CLIENT_SECRET', 'secret');
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({ githubUser: {
            id: '123', token: Buffer.from('gho_old'), refreshToken: Buffer.from('refresh-old'),
        } } as any);
        vi.mocked(db.githubUser.updateMany).mockResolvedValue({ count: 1 });
        fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({
            access_token: 'gho_new', refresh_token: 'refresh-new', expires_in: 28800,
        }) });
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    test('rotates credentials, stores expiry, and coalesces concurrent refreshes', async () => {
        const start = Date.now();
        expect(await Promise.all([
            refreshGithubToken('user', 'gho_old'), refreshGithubToken('user', 'gho_old'),
        ])).toEqual(['gho_new', 'gho_new']);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
            client_id: 'client', client_secret: 'secret', grant_type: 'refresh_token', refresh_token: 'refresh-old',
        });
        const update = vi.mocked(db.githubUser.updateMany).mock.calls[0][0]!;
        expect(update.where).toEqual({ id: '123', token: Buffer.from('gho_old'), Account: { some: { id: 'user' } } });
        expect(update.data).toMatchObject({ token: Buffer.from('gho_new'), refreshToken: Buffer.from('refresh-new') });
        expect((update.data!.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(start + 28800_000);
    });

    test('reuses a token already replaced by another request', async () => {
        expect(await refreshGithubToken('user', 'gho_previous')).toBe('gho_old');
        expect(fetch).not.toHaveBeenCalled();
    });

    test.each([
        { error: 'bad_refresh_token' }, { access_token: 'ghu_app' }, {},
    ])('requires reauthorization for invalid refresh responses: %j', async (data) => {
        fetch.mockResolvedValue({ ok: true, status: 200, json: async () => data });
        await expect(refreshGithubToken('user', 'gho_old')).rejects.toMatchObject({ status: 401 });
        expect(db.githubUser.updateMany).not.toHaveBeenCalled();
    });

    test('requires reauthorization when no refresh token exists', async () => {
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({ githubUser: {
            id: '123', token: Buffer.from('gho_old'), refreshToken: null,
        } } as any);
        await expect(refreshGithubToken('user', 'gho_old')).rejects.toMatchObject({ status: 401 });
        expect(fetch).not.toHaveBeenCalled();
    });

    test('does not refresh GitHub App credentials', async () => {
        vi.mocked(db.account.findUniqueOrThrow).mockResolvedValue({ githubUser: {
            id: '123', token: Buffer.from('ghu_old'), refreshToken: Buffer.from('refresh'),
        } } as any);
        await expect(refreshGithubToken('user', 'ghu_old')).rejects.toMatchObject({ status: 401 });
        expect(fetch).not.toHaveBeenCalled();
    });

    test('does not overwrite a connection changed during refresh', async () => {
        vi.mocked(db.githubUser.updateMany).mockResolvedValue({ count: 0 });
        await expect(refreshGithubToken('user', 'gho_old')).rejects.toMatchObject({ status: 401 });
    });

    test('keeps transient errors distinct and allows a later refresh attempt', async () => {
        fetch.mockResolvedValueOnce({ status: 503 });
        await expect(refreshGithubToken('user', 'gho_old')).rejects.toThrow('temporarily unavailable');
        expect(db.githubUser.updateMany).not.toHaveBeenCalled();
        expect(await refreshGithubToken('user', 'gho_old')).toBe('gho_new');
    });
});

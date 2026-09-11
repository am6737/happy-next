import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { githubRoutes } from './githubRoutes';
import { getUserOctokit } from '@/app/github/githubApi';

vi.mock('@/app/github/githubApi', () => ({
    getUserOctokit: vi.fn(),
    GitHubNotConnectedError: class extends Error {},
}));
vi.mock('@/app/github/githubImageUpload', () => ({ githubImageUpload: vi.fn() }));

let app: ReturnType<typeof Fastify>;
const authenticate = vi.fn(async (request: { userId?: string }) => { request.userId = 'user'; });

beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', authenticate);
    githubRoutes(app as any);
    await app.ready();
});
afterEach(async () => { await app.close(); });

describe('GitHub server boundary', () => {
    test.each([
        '/v1/github/work-items?type=issues',
        '/v1/github/repos',
        '/v1/github/repos/owner/repo',
        '/v1/github/repos/owner/repo/issues',
        '/v1/github/repos/owner/repo/issues/1',
        '/v1/github/repos/owner/repo/issues/1/comments',
        '/v1/github/repos/owner/repo/pulls',
        '/v1/github/repos/owner/repo/pulls/1',
        '/v1/github/repos/owner/repo/commits',
        '/v1/github/repos/owner/repo/contributors',
        '/v1/github/repos/owner/repo/contents',
    ])('does not expose the retired read proxy: %s', async (url) => {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(404);
        expect(getUserOctokit).not.toHaveBeenCalled();
    });

    test.each([
        ['POST', '/v1/github/repos/owner/repo/issues', { title: 'Title' }, 'issues', 'create'],
        ['PATCH', '/v1/github/repos/owner/repo/issues/1', { state: 'closed' }, 'issues', 'update'],
        ['PATCH', '/v1/github/repos/owner/repo/pulls/1', { state: 'closed' }, 'pulls', 'update'],
        ['POST', '/v1/github/repos/owner/repo/issues/1/comments', { body: 'Comment' }, 'issues', 'createComment'],
        ['PATCH', '/v1/github/repos/owner/repo/issues/comments/1', { body: 'Comment' }, 'issues', 'updateComment'],
        ['DELETE', '/v1/github/repos/owner/repo/issues/comments/1', undefined, 'issues', 'deleteComment'],
        ['POST', '/v1/github/repos/owner/repo/pulls', { title: 'Title', head: 'feature', base: 'main' }, 'pulls', 'create'],
    ] as const)('retains authenticated %s %s', async (method, url, payload, group, operation) => {
        const upstream = vi.fn().mockResolvedValue({ data: {
            id: 1, number: 1, title: 'Title', body: 'Comment', state: 'open',
            created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z', author_association: 'OWNER',
        } });
        vi.mocked(getUserOctokit).mockResolvedValue({ rest: { [group]: { [operation]: upstream } } } as any);
        const response = await app.inject({ method, url, payload });
        expect(response.statusCode).toBe(200);
        expect(authenticate).toHaveBeenCalledTimes(1);
        expect(getUserOctokit).toHaveBeenCalledWith('user');
        expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ owner: 'owner', repo: 'repo' }));
    });

    test('retains the image upload route and authentication', async () => {
        expect(app.hasRoute({ method: 'POST', url: '/v1/github/repos/:owner/:repo/upload-image' })).toBe(true);
        const failure = Object.assign(new Error('Unauthorized'), { status: 401 });
        authenticate.mockRejectedValueOnce(failure);
        const response = await app.inject({ method: 'POST', url: '/v1/github/repos/owner/repo/upload-image' });
        expect(response.statusCode).toBe(401);
        expect(getUserOctokit).not.toHaveBeenCalled();
    });

    test.each([
        [{ status: 401 }, 401, 'github_token_expired'],
        [{ status: 403 }, 403, 'GitHub access denied. Check repository permissions and organization OAuth App approval.'],
        [{ status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } }, 429, 'rate_limited'],
        [{ status: 403, response: { headers: { 'retry-after': '60' } } }, 429, 'rate_limited'],
    ])('preserves write error mapping: %j', async (error, status, message) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            vi.mocked(getUserOctokit).mockRejectedValueOnce(error);
            const response = await app.inject({ method: 'POST', url: '/v1/github/repos/owner/repo/issues', payload: { title: 'Title' } });
            expect(response.statusCode).toBe(status);
            expect(response.json()).toEqual({ error: message });
        } finally {
            log.mockRestore();
        }
    });
});

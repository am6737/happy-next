import { createHmac } from 'node:crypto';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(),
    txUpdateMany: vi.fn(), grantsFindMany: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: {
    githubWebhookDelivery: { create: mocks.create, findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    $transaction: vi.fn(async (callback) => callback({
        githubWebhookDelivery: { updateMany: mocks.txUpdateMany },
        aiGithubRepositoryGrant: { findMany: mocks.grantsFindMany },
    })),
} }));
vi.mock('@/app/auth/auth', () => ({ auth: {} }));
vi.mock('@/app/github/githubConnect', () => ({ githubConnect: vi.fn() }));
vi.mock('@/app/github/githubDisconnect', () => ({ githubDisconnect: vi.fn() }));
vi.mock('@/app/github/githubApi', () => ({ getUserGithubAuthorization: vi.fn(), GitHubNotConnectedError: class extends Error {} }));
vi.mock('@/app/github/githubTokenRefresh', () => ({ refreshGithubToken: vi.fn() }));
vi.mock('@/modules/encrypt', () => ({ decryptString: vi.fn(), encryptString: vi.fn() }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));

import { connectRoutes } from './connectRoutes';
import { initGithub } from '@/modules/github';

describe('signed GitHub webhook HTTP route', () => {
    const app = fastify();
    const body = JSON.stringify({ action: 'opened', repository: { id: 1, full_name: 'test/repo' } });
    const headers = { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-github-delivery': 'delivery-1' };

    beforeAll(async () => {
        vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-only-webhook-secret');
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async () => {});
        connectRoutes(app as any);
        await initGithub();
        mocks.create.mockResolvedValue({});
        mocks.txUpdateMany.mockResolvedValue({ count: 1 });
        mocks.grantsFindMany.mockResolvedValue([]);
        await app.ready();
    });
    afterAll(async () => { await app.close(); vi.unstubAllEnvs(); });

    it('rejects a bad signature before checking a previously successful delivery', async () => {
        const signature = `sha256=${createHmac('sha256', 'test-only-webhook-secret').update(body).digest('hex')}`;
        const first = await app.inject({ method: 'POST', url: '/v1/connect/github/webhook',
            headers: { ...headers, 'x-hub-signature-256': signature }, payload: body });
        expect(first.statusCode).toBe(200);
        vi.clearAllMocks();
        const invalid = await app.inject({ method: 'POST', url: '/v1/connect/github/webhook',
            headers: { ...headers, 'x-hub-signature-256': 'sha256=invalid' }, payload: body });
        expect(invalid.statusCode).toBe(401);
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('accepts a correctly signed delivery and commits its terminal state', async () => {
        const signature = `sha256=${createHmac('sha256', 'test-only-webhook-secret').update(body).digest('hex')}`;
        const valid = await app.inject({ method: 'POST', url: '/v1/connect/github/webhook',
            headers: { ...headers, 'x-hub-signature-256': signature }, payload: body });
        expect(valid.statusCode).toBe(200);
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            id: 'delivery-1', status: 'processing', payloadHash: expect.any(String),
        }) });
        expect(mocks.txUpdateMany).toHaveBeenCalledWith({ where: expect.objectContaining({
            id: 'delivery-1', status: 'processing',
        }), data: expect.objectContaining({ status: 'succeeded' }) });
    });
});

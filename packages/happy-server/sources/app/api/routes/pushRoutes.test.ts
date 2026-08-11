import fastify from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Fastify } from '../types';

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    updateAccount: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        accountPushToken: {
            upsert: mocks.upsert,
            deleteMany: mocks.deleteMany,
            findMany: mocks.findMany,
        },
        account: { update: mocks.updateAccount },
    },
}));

import { pushRoutes } from './pushRoutes';

describe('push token ownership', () => {
    let app: ReturnType<typeof fastify>;

    beforeAll(async () => {
        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any) => {
            request.userId = 'account-b';
        });
        pushRoutes(app as unknown as Fastify);
        await app.ready();
    });

    beforeEach(() => {
        mocks.upsert.mockReset().mockResolvedValue({});
        mocks.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    });

    it('transfers an existing device token to the authenticated account', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/push-tokens',
            payload: { token: 'shared-device-token' },
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledWith({
            where: { token: 'shared-device-token' },
            update: {
                accountId: 'account-b',
                updatedAt: expect.any(Date),
            },
            create: {
                accountId: 'account-b',
                token: 'shared-device-token',
            },
        });
    });

    it('scopes unregistering to the authenticated account', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/v1/push-tokens/shared-device-token',
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: {
                accountId: 'account-b',
                token: 'shared-device-token',
            },
        });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
global.fetch = fetchMock;

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://server.example' }));
vi.mock('@/utils/time', () => ({
    backoff: (callback: () => Promise<unknown>) => callback(),
}));

import { deletePushToken, registerPushToken } from './apiPush';

describe('push token API', () => {
    beforeEach(() => {
        fetchMock.mockReset().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
    });

    it('registers the current device token', async () => {
        const controller = new AbortController();
        await registerPushToken(
            { token: 'auth-token', secret: 'secret' },
            'push-token',
            controller.signal,
        );

        expect(fetchMock).toHaveBeenCalledWith(
            'https://server.example/v1/push-tokens',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ token: 'push-token' }),
                signal: controller.signal,
            }),
        );
    });

    it('passes an abort signal when unregistering the token', async () => {
        const controller = new AbortController();
        await deletePushToken(
            { token: 'auth-token', secret: 'secret' },
            'push/token',
            controller.signal,
        );

        expect(fetchMock).toHaveBeenCalledWith(
            'https://server.example/v1/push-tokens/push%2Ftoken',
            expect.objectContaining({ signal: controller.signal }),
        );
    });
});

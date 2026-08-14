import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deletePushToken: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
    unregisterForNotificationsAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({
    default: {
        expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    },
}));
vi.mock('expo-notifications', () => ({
    getExpoPushTokenAsync: mocks.getExpoPushTokenAsync,
    unregisterForNotificationsAsync: mocks.unregisterForNotificationsAsync,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./apiPush', () => ({ deletePushToken: mocks.deletePushToken }));

import { unregisterCurrentPushToken } from './pushTokenLogout';

describe('unregisterCurrentPushToken', () => {
    beforeEach(() => {
        mocks.deletePushToken.mockReset().mockResolvedValue(undefined);
        mocks.getExpoPushTokenAsync.mockReset().mockResolvedValue({ data: 'expo-token' });
        mocks.unregisterForNotificationsAsync.mockReset().mockResolvedValue(undefined);
    });

    it('removes the Expo token for only the current installation', async () => {
        const credentials = { token: 'auth-token', secret: 'secret' };
        await unregisterCurrentPushToken(credentials, 100);

        expect(mocks.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            'expo-token',
            expect.any(AbortSignal),
        );
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
    });

    it('waits for server cleanup before unregistering the device locally', async () => {
        let resolveToken: ((value: { data: string }) => void) | undefined;
        mocks.getExpoPushTokenAsync.mockReturnValue(new Promise((resolve) => {
            resolveToken = resolve;
        }));

        const unregistering = unregisterCurrentPushToken(
            { token: 'auth-token', secret: 'secret' },
            100,
        );

        await vi.waitFor(() => expect(mocks.getExpoPushTokenAsync).toHaveBeenCalledOnce());
        expect(mocks.unregisterForNotificationsAsync).not.toHaveBeenCalled();

        resolveToken?.({ data: 'expo-token' });
        await unregistering;

        expect(mocks.deletePushToken.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.unregisterForNotificationsAsync.mock.invocationCallOrder[0],
        );
    });

    it('unregisters the device locally when the server cleanup fails', async () => {
        mocks.deletePushToken.mockRejectedValue(new Error('server unavailable'));

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
    });

    it('does not block logout when Expo token lookup stalls', async () => {
        mocks.getExpoPushTokenAsync.mockReturnValue(new Promise(() => {}));

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 1);

        expect(mocks.deletePushToken).not.toHaveBeenCalled();
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
    });
});

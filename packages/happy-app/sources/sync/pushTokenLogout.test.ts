import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deletePushToken: vi.fn(),
    getStoredDooPushRegistrationToken: vi.fn(),
    invalidateDooPushRegistration: vi.fn(),
    getStoredExpoFallbackToken: vi.fn(),
    clearStoredExpoFallbackToken: vi.fn(),
    getPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
    unregisterForNotificationsAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({
    default: {
        expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    },
}));
vi.mock('expo-notifications', () => ({
    getPermissionsAsync: mocks.getPermissionsAsync,
    getExpoPushTokenAsync: mocks.getExpoPushTokenAsync,
    unregisterForNotificationsAsync: mocks.unregisterForNotificationsAsync,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./apiPush', () => ({ deletePushToken: mocks.deletePushToken }));
vi.mock('./doopushRegistrationState', () => ({
    getStoredDooPushRegistrationToken: mocks.getStoredDooPushRegistrationToken,
    invalidateDooPushRegistration: mocks.invalidateDooPushRegistration,
}));
vi.mock('./expoPushMigrationState', () => ({
    getStoredExpoFallbackToken: mocks.getStoredExpoFallbackToken,
    clearStoredExpoFallbackToken: mocks.clearStoredExpoFallbackToken,
}));

import { unregisterCurrentPushToken } from './pushTokenLogout';

describe('unregisterCurrentPushToken', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    beforeEach(() => {
        mocks.deletePushToken.mockReset().mockResolvedValue(undefined);
        mocks.getStoredDooPushRegistrationToken.mockReset().mockReturnValue('doopush-token');
        mocks.invalidateDooPushRegistration.mockReset();
        mocks.getStoredExpoFallbackToken.mockReset().mockReturnValue('expo-token');
        mocks.clearStoredExpoFallbackToken.mockReset();
        mocks.getPermissionsAsync.mockReset().mockResolvedValue({ status: 'granted' });
        mocks.getExpoPushTokenAsync.mockReset().mockResolvedValue({ data: 'expo-token' });
        mocks.unregisterForNotificationsAsync.mockReset().mockResolvedValue(undefined);
    });

    it('removes both provider tokens for only the current installation', async () => {
        const credentials = { token: 'auth-token', secret: 'secret' };
        await unregisterCurrentPushToken(credentials, 100);

        expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledTimes(2);
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            'doopush-token',
            expect.any(AbortSignal),
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            'expo-token',
            expect.any(AbortSignal),
        );
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
        expect(mocks.clearStoredExpoFallbackToken).toHaveBeenCalledWith('expo-token');
    });

    it('waits for server cleanup before unregistering the device locally', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
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

    it('rejects while still unregistering locally when server cleanup fails', async () => {
        mocks.deletePushToken.mockRejectedValue(new Error('server unavailable'));

        await expect(
            unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100),
        ).rejects.toThrow('server unavailable');

        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
        expect(mocks.clearStoredExpoFallbackToken).toHaveBeenCalledWith('expo-token');
    });

    it('rejects on timeout when Expo token lookup stalls', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
        mocks.getExpoPushTokenAsync.mockReturnValue(new Promise(() => {}));

        await expect(
            unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 1),
        ).rejects.toThrow('Timed out');

        expect(mocks.deletePushToken).toHaveBeenCalledOnce();
        expect(mocks.deletePushToken.mock.calls[0][1]).toBe('doopush-token');
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
    });

    it('does not request an Expo token when notification permission was never granted', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
        mocks.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledOnce();
    });

    it('keeps the DooPush snapshot current when native unregistration fails', async () => {
        mocks.unregisterForNotificationsAsync.mockRejectedValue(new Error('native failure'));

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        expect(mocks.invalidateDooPushRegistration).not.toHaveBeenCalled();
    });
    it.each(['resolve', 'reject'] as const)('bounds native unregistration and ignores a late %s', async (outcome) => {
        vi.useFakeTimers();
        let resolveLate!: () => void;
        let rejectLate!: (error: Error) => void;
        mocks.unregisterForNotificationsAsync.mockReturnValue(new Promise<void>((resolve, reject) => {
            resolveLate = resolve;
            rejectLate = reject;
        }));
        const finished = vi.fn();
        const unregistering = unregisterCurrentPushToken({ token: 'auth', secret: 'secret' }).then(finished);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(finished).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await unregistering;
        expect(finished).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).not.toHaveBeenCalled();
        expect(mocks.clearStoredExpoFallbackToken).not.toHaveBeenCalled();

        // A new login could have registered by now. The old completion must not
        // invalidate its snapshot or produce an unhandled rejection.
        if (outcome === 'resolve') resolveLate();
        else rejectLate(new Error('late native failure'));
        await vi.runAllTimersAsync();
        expect(mocks.invalidateDooPushRegistration).not.toHaveBeenCalled();
        expect(mocks.clearStoredExpoFallbackToken).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the remote timeout when both remote and native cleanup hang', async () => {
        vi.useFakeTimers();
        mocks.deletePushToken.mockReturnValue(new Promise(() => {}));
        mocks.unregisterForNotificationsAsync.mockReturnValue(new Promise(() => {}));
        const result = unregisterCurrentPushToken({ token: 'auth', secret: 'secret' })
            .then(() => null, (error: Error) => error);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.deletePushToken.mock.calls[0][2].aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(await result).toEqual(new Error('Timed out while unregistering push tokens'));
        expect(mocks.invalidateDooPushRegistration).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([true, false])('separates token lookup from DELETE timings (cached=%s)', async (cached) => {
        vi.stubGlobal('__DEV__', true);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        if (!cached) mocks.getStoredExpoFallbackToken.mockReturnValue(null);

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        const lines = log.mock.calls.map(([line]) => line as string);
        expect(lines).toContain(`[logout] expo-token-source: ${cached ? 'cached' : 'lookup'}`);
        for (const stage of ['delete-doopush-binding', 'delete-expo-binding']) {
            expect(lines).toContain(`[logout] ${stage}: start`);
            expect(lines.some((line) => line.startsWith(`[logout] ${stage}: ok (`))).toBe(true);
        }
        for (const stage of ['notification-permissions', 'get-expo-token']) {
            expect(lines.includes(`[logout] ${stage}: start`)).toBe(!cached);
        }
        if (!cached) {
            const lookupDone = lines.findIndex((line) => line.startsWith('[logout] get-expo-token: ok ('));
            expect(lookupDone).toBeGreaterThanOrEqual(0);
            expect(lines.indexOf('[logout] delete-expo-binding: start')).toBeGreaterThan(lookupDone);
        }
        expect(lines.join('\n')).not.toMatch(/auth-token|secret|doopush-token/);
        expect(lines).not.toContain('expo-token');
        expect(mocks.deletePushToken).toHaveBeenCalledTimes(2);
    });

});

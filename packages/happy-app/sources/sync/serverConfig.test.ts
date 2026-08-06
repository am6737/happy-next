import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) { return mmkvValues.get(key); }
        set(key: string, value: string) { mmkvValues.set(key, value); }
        delete(key: string) { mmkvValues.delete(key); }
    },
}));

const mmkvValues = new Map<string, string>();

function appConfigResponse(apiBaseUrl: string) {
    return {
        ok: true,
        json: async () => ({ apiBaseUrl, voice: null }),
    } as Response;
}

describe('serverConfig discovery', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        mmkvValues.clear();
        delete process.env.EXPO_PUBLIC_HAPPY_SERVER_URL;
        delete process.env.EXPO_PUBLIC_HAPPY_SERVER_URL_OVERRIDE;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('uses a config returned within the startup wait', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(appConfigResponse('https://resolved.example')));
        const serverConfig = await import('./serverConfig');

        await serverConfig.resolveServerConfig();

        expect(serverConfig.getServerUrl()).toBe('https://resolved.example');
    });

    it('continues discovery after startup falls back to the first entry URL', async () => {
        let completeRequest!: (response: Response) => void;
        const pendingResponse = new Promise<Response>((resolve) => {
            completeRequest = resolve;
        });
        vi.stubGlobal('fetch', vi.fn(() => pendingResponse));
        const serverConfig = await import('./serverConfig');

        const startup = serverConfig.resolveServerConfig();
        await vi.advanceTimersByTimeAsync(5_000);
        await startup;
        expect(serverConfig.getServerUrl()).toBe('https://api.happy-next.com');

        completeRequest(appConfigResponse('https://resolved.example'));
        await vi.advanceTimersByTimeAsync(0);
        expect(serverConfig.getServerUrl()).toBe('https://resolved.example');
    });

    it('lets an explicit runtime override take precedence over a stored custom URL', async () => {
        mmkvValues.set('custom-server-url', 'https://stored.example');
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://configured.example';
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL_OVERRIDE = 'http://127.0.0.1:3032';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
        const serverConfig = await import('./serverConfig');

        expect(serverConfig.getServerEntryUrl()).toBe('http://127.0.0.1:3032');
    });
});

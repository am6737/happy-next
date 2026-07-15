import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString() { return undefined; }
        set() {}
        delete() {}
    },
}));

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
        delete process.env.EXPO_PUBLIC_HAPPY_SERVER_URL;
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
});

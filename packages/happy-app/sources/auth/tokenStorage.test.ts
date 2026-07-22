import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    isTauriDesktop: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauri', () => ({ isTauriDesktop: mocks.isTauriDesktop }));
vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { TokenStorage, type AuthCredentials } from './tokenStorage';

describe('desktop token storage', () => {
    const values = new Map<string, string>();
    const localStorage = {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        values.clear();
        vi.stubGlobal('localStorage', localStorage);
        mocks.isTauriDesktop.mockReturnValue(true);
    });

    it('clears legacy WebView credentials and reads from the system credential store', async () => {
        const credentials: AuthCredentials = { token: 'token', secret: 'secret' };
        values.set('auth_credentials', JSON.stringify(credentials));
        mocks.invoke.mockResolvedValue(credentials);

        await expect(TokenStorage.getCredentials()).resolves.toEqual(credentials);

        expect(values.has('auth_credentials')).toBe(false);
        expect(mocks.invoke).toHaveBeenCalledWith('desktop_get_credentials');
    });

    it('writes new desktop credentials only through the native command', async () => {
        const credentials: AuthCredentials = { token: 'token', secret: 'secret' };
        values.set('auth_credentials', 'legacy');
        mocks.invoke.mockResolvedValue(undefined);

        await expect(TokenStorage.setCredentials(credentials)).resolves.toBe(true);

        expect(values.has('auth_credentials')).toBe(false);
        expect(localStorage.setItem).not.toHaveBeenCalled();
        expect(mocks.invoke).toHaveBeenCalledWith('desktop_set_credentials', { credentials });
    });

    it('removes credentials from both legacy storage and the system credential store', async () => {
        values.set('auth_credentials', 'legacy');
        mocks.invoke.mockResolvedValue(undefined);

        await expect(TokenStorage.removeCredentials()).resolves.toBe(true);

        expect(values.has('auth_credentials')).toBe(false);
        expect(mocks.invoke).toHaveBeenCalledWith('desktop_remove_credentials');
    });
});

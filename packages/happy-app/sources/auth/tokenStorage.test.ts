import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    secureStoreGet: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
    getItemAsync: mocks.secureStoreGet,
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { TokenStorage, type AuthCredentials } from './tokenStorage';

describe('web and desktop token storage', () => {
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
    });

    it('reads credentials from local storage', async () => {
        const credentials: AuthCredentials = { token: 'token', secret: 'secret' };
        values.set('auth_credentials', JSON.stringify(credentials));

        await expect(TokenStorage.getCredentials()).resolves.toEqual(credentials);

        expect(values.has('auth_credentials')).toBe(true);
        expect(mocks.secureStoreGet).not.toHaveBeenCalled();
    });

    it('writes credentials to local storage', async () => {
        const credentials: AuthCredentials = { token: 'token', secret: 'secret' };

        await expect(TokenStorage.setCredentials(credentials)).resolves.toBe(true);

        expect(values.get('auth_credentials')).toBe(JSON.stringify(credentials));
        expect(localStorage.setItem).toHaveBeenCalledWith('auth_credentials', JSON.stringify(credentials));
    });

    it('removes credentials from local storage', async () => {
        values.set('auth_credentials', 'stored');

        await expect(TokenStorage.removeCredentials()).resolves.toBe(true);

        expect(values.has('auth_credentials')).toBe(false);
        expect(localStorage.removeItem).toHaveBeenCalledWith('auth_credentials');
    });
});

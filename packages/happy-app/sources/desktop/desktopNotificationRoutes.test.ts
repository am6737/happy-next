import { describe, expect, it } from 'vitest';

import {
    clearDesktopNotificationRoutes,
    rememberDesktopNotificationRoute,
    resolveDesktopNotificationRoute,
} from './desktopNotificationRoutes';

function createMemoryStorage(initialValues: Record<string, string> = {}) {
    const values = new Map(Object.entries(initialValues));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
    };
}

describe('desktop notification routes', () => {
    it('resolves a remembered notification after reading storage again', () => {
        const storage = createMemoryStorage();

        rememberDesktopNotificationRoute(42, 'session-42', storage);

        expect(resolveDesktopNotificationRoute(42, storage)).toBe('session-42');
    });

    it('ignores malformed persisted routes', () => {
        const storage = createMemoryStorage({
            'desktop-notification-routes-v1': '{broken',
        });

        expect(resolveDesktopNotificationRoute(42, storage)).toBeNull();
    });

    it('clears persisted routes on sign-out', () => {
        const storage = createMemoryStorage();
        rememberDesktopNotificationRoute(42, 'session-42', storage);

        clearDesktopNotificationRoutes(storage);

        expect(resolveDesktopNotificationRoute(42, storage)).toBeNull();
    });

    it('does not throw when persistent storage is unavailable', () => {
        const unavailableStorage = {
            getItem: () => null,
            setItem: () => { throw new Error('unavailable'); },
            removeItem: () => { throw new Error('unavailable'); },
        };

        expect(() => rememberDesktopNotificationRoute(42, 'session-42', unavailableStorage)).not.toThrow();
        expect(() => clearDesktopNotificationRoutes(unavailableStorage)).not.toThrow();
    });
});

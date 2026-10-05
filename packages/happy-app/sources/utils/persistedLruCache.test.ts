import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPersistedLruCache, type PersistedCacheStorage } from './persistedLruCache';

function memoryStorage(initial?: string): PersistedCacheStorage & { raw: string | undefined } {
    const storage = {
        raw: initial,
        load: () => storage.raw,
        save: (raw: string) => { storage.raw = raw; },
        remove: () => { storage.raw = undefined; },
    };
    return storage;
}

describe('createPersistedLruCache', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('evicts the least recently written entry', () => {
        const cache = createPersistedLruCache<number>({ maxSize: 2 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 3);
        cache.set('c', 4);
        expect(cache.has('b')).toBe(false);
        expect(cache.get('a')).toBe(3);
        expect(cache.get('c')).toBe(4);
    });

    test('persists coalesced writes and restores them in order', () => {
        const storage = memoryStorage();
        const cache = createPersistedLruCache<string>({ maxSize: 2, storage });
        cache.set('a', 'x');
        cache.set('b', 'y');
        expect(storage.raw).toBeUndefined();
        vi.runAllTimers();

        const restored = createPersistedLruCache<string>({ maxSize: 2, storage });
        expect(restored.get('a')).toBe('x');
        restored.set('c', 'z');
        expect(restored.has('a')).toBe(false);
        expect(restored.get('b')).toBe('y');
    });

    test('drops expired entries on read and on load', () => {
        let now = 1_000;
        const storage = memoryStorage();
        const cache = createPersistedLruCache<number>({ maxSize: 5, maxAgeMs: 100, storage, now: () => now });
        cache.set('old', 1);
        now += 50;
        cache.set('fresh', 2);
        vi.runAllTimers();
        now += 60;
        expect(cache.has('old')).toBe(false);
        expect(cache.get('fresh')).toBe(2);

        const restored = createPersistedLruCache<number>({ maxSize: 5, maxAgeMs: 100, storage, now: () => now });
        expect(restored.has('old')).toBe(false);
        expect(restored.get('fresh')).toBe(2);
    });

    test('clear cancels pending writes and removes persisted data', () => {
        const storage = memoryStorage();
        const cache = createPersistedLruCache<number>({ maxSize: 2, storage });
        cache.set('a', 1);
        vi.runAllTimers();
        cache.set('b', 2);
        cache.clear();
        vi.runAllTimers();
        expect(storage.raw).toBeUndefined();
        expect(cache.has('a')).toBe(false);
    });

    test('ignores corrupt persisted data', () => {
        const cache = createPersistedLruCache<number>({ maxSize: 2, storage: memoryStorage('{not json') });
        expect(cache.has('a')).toBe(false);
    });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import { GithubWorkCache, githubWorkCacheScope } from './githubWorkCache';

afterEach(() => vi.useRealTimers());

describe('GithubWorkCache', () => {
    test('shares concurrent loads and expires completed results', async () => {
        vi.useFakeTimers();
        const cache = new GithubWorkCache();
        const load = vi.fn(async () => ['repo']);
        const hit = vi.fn();
        await Promise.all([cache.get('user', 'repos', 1000, load, hit), cache.get('user', 'repos', 1000, load, hit)]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(hit).toHaveBeenCalledTimes(1);
        await cache.get('user', 'repos', 1000, load, hit);
        expect(load).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1001);
        await cache.get('user', 'repos', 1000, load, hit);
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('isolates users and changed GitHub authorization', async () => {
        const cache = new GithubWorkCache();
        const load = vi.fn(async () => []);
        for (const [user, token] of [['a', 'token'], ['b', 'token'], ['a', 'new-token']]) {
            await cache.get(githubWorkCacheScope(user, token), 'repos', 1000, load, () => {});
        }
        expect(load).toHaveBeenCalledTimes(3);
        expect(githubWorkCacheScope('a', 'secret')).not.toContain('secret');
    });

    test('does not cache errors', async () => {
        const cache = new GithubWorkCache();
        const load = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce('ok');
        await expect(cache.get('user', 'repos', 1000, load, () => {})).rejects.toThrow('failed');
        expect(await cache.get('user', 'repos', 1000, load, () => {})).toBe('ok');
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('refresh invalidates in-flight work without allowing it to overwrite new data', async () => {
        const cache = new GithubWorkCache();
        let resolve!: (value: string) => void;
        const old = cache.get('user', 'repos', 1000, () => new Promise<string>((r) => { resolve = r; }), () => {});
        await Promise.resolve();
        cache.invalidate('user');
        await cache.get('user', 'repos', 1000, async () => 'new', () => {});
        resolve('old');
        await old;
        const load = vi.fn(async () => 'wrong');
        expect(await cache.get('user', 'repos', 1000, load, () => {})).toBe('new');
        expect(load).not.toHaveBeenCalled();
    });

    test('oversized responses preserve other users cached results and byte accounting', async () => {
        const cache = new GithubWorkCache(10, 10);
        const first = vi.fn(async () => 'ok');
        const second = vi.fn(async () => 'ok');
        const oversized = vi.fn(async () => 'x'.repeat(20));
        const hit = vi.fn();
        await cache.get('a', 'first', 1000, first, hit);
        await cache.get('b', 'second', 1000, second, hit);

        for (let i = 0; i < 2; i++) {
            expect(await cache.get('c', 'large', 1000, oversized, hit)).toBe('x'.repeat(20));
            expect(await cache.get('a', 'first', 1000, first, hit)).toBe('ok');
            expect(await cache.get('b', 'second', 1000, second, hit)).toBe('ok');
        }
        expect(oversized).toHaveBeenCalledTimes(2);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(hit).toHaveBeenCalledTimes(4);

        // Three four-byte values exceed the budget and should evict only the oldest.
        await cache.get('d', 'third', 1000, async () => 'ok', hit);
        await cache.get('b', 'second', 1000, second, hit);
        expect(second).toHaveBeenCalledTimes(1);
        await cache.get('a', 'first', 1000, first, hit);
        expect(first).toHaveBeenCalledTimes(2);
    });

    test('retains a response that exactly fits the byte limit', async () => {
        const cache = new GithubWorkCache(10, 4);
        const load = vi.fn(async () => 'ok');
        await cache.get('user', 'exact', 1000, load, () => {});
        await cache.get('user', 'exact', 1000, load, () => {});
        expect(load).toHaveBeenCalledTimes(1);
    });

    test('bounds entry count and response bytes', async () => {
        const cache = new GithubWorkCache(1, 10);
        const load = vi.fn(async () => 'ok');
        await cache.get('user', 'first', 1000, load, () => {});
        await cache.get('user', 'second', 1000, load, () => {});
        await cache.get('user', 'first', 1000, load, () => {});
        expect(load).toHaveBeenCalledTimes(3);
        const oversized = vi.fn(async () => 'x'.repeat(20));
        await cache.get('user', 'large', 1000, oversized, () => {});
        await cache.get('user', 'large', 1000, oversized, () => {});
        expect(oversized).toHaveBeenCalledTimes(2);
    });
});

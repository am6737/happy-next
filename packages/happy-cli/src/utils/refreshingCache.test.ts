import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshingCache } from './refreshingCache';

const MINUTE = 60_000;

describe('createRefreshingCache', () => {
    let dir: string;
    let file: string;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(0);
        dir = await mkdtemp(join(tmpdir(), 'refreshing-cache-'));
        file = join(dir, 'value.json');
    });

    afterEach(async () => {
        vi.useRealTimers();
        await rm(dir, { recursive: true, force: true });
    });

    const create = (fetch: () => Promise<string>) => createRefreshingCache({
        file,
        fetch,
        freshMs: 5 * MINUTE,
        maxAgeMs: 60 * MINUTE,
        failureCooldownMs: 5 * MINUTE,
        emptyFailureCooldownMs: MINUTE,
    });

    it('fetches once for asks made together, saves the value and serves it while fresh', async () => {
        const fetch = vi.fn().mockResolvedValue('v1');
        const cache = create(fetch);

        expect(await Promise.all([cache.get(), cache.get()])).toEqual(['v1', 'v1']);
        vi.setSystemTime(4 * MINUTE);
        expect(await cache.get()).toBe('v1');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 'v1', fetchedAt: 0 });
    });

    it('starts from the saved value', async () => {
        await writeFile(file, JSON.stringify({ value: 'saved', fetchedAt: 0 }));
        const fetch = vi.fn().mockResolvedValue('new');

        expect(await create(fetch).get()).toBe('saved');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('serves a value under an hour old and refreshes it for the next ask', async () => {
        const fetch = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
        const cache = create(fetch);
        await cache.get();

        vi.setSystemTime(10 * MINUTE);
        expect(await cache.get()).toBe('v1');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        await vi.waitFor(async () => expect(await cache.get()).toBe('v2'));
    });

    it('refreshes a value over an hour old first, and serves it if that fails', async () => {
        const fetch = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2').mockRejectedValueOnce(new Error('offline'));
        const cache = create(fetch);
        await cache.get();

        vi.setSystemTime(61 * MINUTE);
        expect(await cache.get()).toBe('v2');
        vi.setSystemTime(122 * MINUTE);
        expect(await cache.get()).toBe('v2');
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('does not fetch again for 5 minutes after a failure while a value is on hand', async () => {
        const fetch = vi.fn().mockResolvedValueOnce('v1').mockRejectedValue(new Error('offline'));
        const cache = create(fetch);
        await cache.get();

        vi.setSystemTime(61 * MINUTE);
        expect(await cache.get()).toBe('v1');
        vi.setSystemTime(65 * MINUTE);
        expect(await cache.get()).toBe('v1');
        expect(fetch).toHaveBeenCalledTimes(2);
        vi.setSystemTime(66 * MINUTE);
        expect(await cache.get()).toBe('v1');
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('fails at once for a minute after a failure with no value on hand', async () => {
        const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('v1');
        const cache = create(fetch);

        await expect(cache.get()).rejects.toThrow('offline');
        vi.setSystemTime(MINUTE - 1);
        await expect(cache.get()).rejects.toThrow('offline');
        expect(fetch).toHaveBeenCalledTimes(1);
        vi.setSystemTime(MINUTE);
        expect(await cache.get()).toBe('v1');
    });
});

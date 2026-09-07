import { createHash } from 'node:crypto';

type Entry = { promise: Promise<unknown>; expiresAt: number; bytes: number };

// Process-local and bounded; failures and oversized responses are never retained.
export class GithubWorkCache {
    private entries = new Map<string, Entry>();
    private bytes = 0;

    constructor(private maxEntries = 256, private maxBytes = 16 * 1024 * 1024) {}

    invalidate(scope: string) {
        for (const key of this.entries.keys()) {
            if (key.startsWith(`${scope}:`)) this.remove(key);
        }
    }

    private remove(key: string) {
        this.bytes -= this.entries.get(key)?.bytes ?? 0;
        this.entries.delete(key);
    }

    async get<T>(scope: string, key: string, ttl: number, load: () => Promise<T>, hit: () => void): Promise<T> {
        const cacheKey = `${scope}:${key}`;
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.remove(key);
        }
        const cached = this.entries.get(cacheKey);
        if (cached) {
            hit();
            return cached.promise as Promise<T>;
        }
        while (this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value!);
        const entry: Entry = { promise: Promise.resolve(), expiresAt: Infinity, bytes: 0 };
        entry.promise = Promise.resolve().then(load).then((value) => {
            if (this.entries.get(cacheKey) === entry) {
                const bytes = Buffer.byteLength(JSON.stringify(value));
                if (bytes > this.maxBytes) {
                    this.remove(cacheKey);
                    return value;
                }
                entry.bytes = bytes;
                entry.expiresAt = Date.now() + ttl;
                this.bytes += entry.bytes;
                while (this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
            }
            return value;
        }).catch((error) => {
            if (this.entries.get(cacheKey) === entry) this.remove(cacheKey);
            throw error;
        });
        this.entries.set(cacheKey, entry);
        return entry.promise as Promise<T>;
    }
}

export const githubWorkCache = new GithubWorkCache();

export function githubWorkCacheScope(userId: string, token: string): string {
    return createHash('sha256').update(JSON.stringify([userId, token])).digest('hex');
}

export function createWorkMetrics() {
    return { repositoryRequests: 0, searchRequests: 0, repositoryCacheHits: 0, searchCacheHits: 0, searchRequestMs: 0 };
}

export type WorkCacheContext = { scope: string; metrics: ReturnType<typeof createWorkMetrics> };

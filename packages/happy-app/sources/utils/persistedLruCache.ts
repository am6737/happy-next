/**
 * Small LRU cache with optional best-effort persistence. Entries are kept in
 * recency order (oldest first) and written back as one serialized blob.
 */

export interface PersistedCacheStorage {
    load(): string | undefined;
    save(raw: string): void;
    remove(): void;
}

export interface PersistedLruCache<V> {
    get(key: string): V | undefined;
    has(key: string): boolean;
    set(key: string, value: V): void;
    delete(key: string): void;
    clear(): void;
}

type Entry<V> = { value: V; savedAt: number };
type SerializedEntry = [key: string, value: unknown, savedAt: number];

export function createPersistedLruCache<V>(options: {
    maxSize: number;
    /** Entries older than this are dropped on read and on load. */
    maxAgeMs?: number;
    storage?: PersistedCacheStorage | null;
    now?: () => number;
}): PersistedLruCache<V> {
    const { maxSize, maxAgeMs, storage } = options;
    const now = options.now ?? Date.now;
    const entries = new Map<string, Entry<V>>();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const isExpired = (entry: Entry<V>) => maxAgeMs !== undefined && now() - entry.savedAt > maxAgeMs;

    const persistNow = () => {
        saveTimer = null;
        if (!storage) return;
        try {
            const serialized: SerializedEntry[] = [];
            for (const [key, entry] of entries) serialized.push([key, entry.value, entry.savedAt]);
            storage.save(JSON.stringify({ entries: serialized }));
        } catch { /* best effort */ }
    };

    // Coalesce writes made in the same tick (e.g. a prefetch filling several keys).
    const schedulePersist = () => {
        if (!storage || saveTimer) return;
        saveTimer = setTimeout(persistNow, 0);
    };

    if (storage) {
        try {
            const raw = storage.load();
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && Array.isArray(parsed.entries)) {
                for (const item of parsed.entries as SerializedEntry[]) {
                    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[2] !== 'number') continue;
                    const entry = { value: item[1] as V, savedAt: item[2] };
                    if (!isExpired(entry)) entries.set(item[0], entry);
                }
                while (entries.size > maxSize) entries.delete(entries.keys().next().value!);
            }
        } catch { /* ignore corrupt cache */ }
    }

    const read = (key: string): Entry<V> | undefined => {
        const entry = entries.get(key);
        if (!entry) return undefined;
        if (isExpired(entry)) {
            entries.delete(key);
            schedulePersist();
            return undefined;
        }
        return entry;
    };

    return {
        get: (key) => read(key)?.value,
        has: (key) => read(key) !== undefined,
        set: (key, value) => {
            if (entries.has(key)) {
                entries.delete(key);
            } else if (entries.size >= maxSize) {
                entries.delete(entries.keys().next().value!);
            }
            entries.set(key, { value, savedAt: now() });
            schedulePersist();
        },
        delete: (key) => {
            if (entries.delete(key)) schedulePersist();
        },
        clear: () => {
            entries.clear();
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            try { storage?.remove(); } catch { /* best effort */ }
        },
    };
}

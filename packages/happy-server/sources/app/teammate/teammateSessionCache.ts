import { db } from '@/storage/db';
import type { TeammateSession } from '@prisma/client';

export const TEAMMATE_SESSION_CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;
const cache = new Map<string, { value: TeammateSession | null; expiresAt: number }>();

/** Invalidate negative lookups when started or worker registration creates a teammate session after commit. */
export function teammateSessionCacheInvalidate(sessionId: string): void { cache.delete(sessionId); }

/** Bounded LRU lookup caches both teammate sessions and ordinary-session misses. */
export async function teammateSessionLookup(sessionId: string): Promise<TeammateSession | null> {
    const now = Date.now();
    const entry = cache.get(sessionId);
    if (entry && entry.expiresAt > now) {
        cache.delete(sessionId);
        cache.set(sessionId, entry);
        return entry.value;
    }
    cache.delete(sessionId);
    const value = await db.teammateSession.findUnique({ where: { sessionId } });
    cache.set(sessionId, { value, expiresAt: now + TEAMMATE_SESSION_CACHE_TTL_MS });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return value;
}

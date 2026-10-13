import { searchMessagesResponseSchema, type SearchMessagesRequest } from 'happy-wire';
import { apiSocket } from './apiSocket';
import type { CachedMessageSearchMatch } from './messagesStore/cachedMessageSearch';

// The whole round trip through the server. Hits show as each machine answers, so a slow one holds
// nothing else back; this only bounds how long the palette keeps waiting on it.
const MACHINE_SEARCH_TIMEOUT_MS = 15_000;

/**
 * Search the message archive a machine keeps of every session it ran. Machines without the
 * `search-messages` RPC (older CLIs), offline ones and slow ones yield no hits.
 */
export async function searchMachineMessages(
    machineId: string,
    query: string,
    limit = 50,
    perSessionLimit = 10,
): Promise<CachedMessageSearchMatch[]> {
    try {
        const response = await apiSocket.machineRPC<unknown, SearchMessagesRequest>(
            machineId,
            'search-messages',
            { query, limit, perSessionLimit },
            MACHINE_SEARCH_TIMEOUT_MS,
        );
        const parsed = searchMessagesResponseSchema.safeParse(response);
        if (!parsed.success) return [];
        return parsed.data.hits.map((hit) => ({
            sessionId: hit.sessionId,
            snippet: hit.snippet,
            messageId: hit.id,
            role: hit.role,
            seq: hit.seq,
            createdAt: hit.createdAt,
        }));
    } catch (error) {
        console.warn(`[MessageSearch] Machine ${machineId} search failed:`, error);
        return [];
    }
}

/**
 * Merge hits from local search and every machine: each message once, newest first within a session,
 * sessions in `sessionOrder` — hits for sessions not in it (deleted, or not shared with this
 * account) are dropped, since there is nothing to open them in.
 */
export function mergeMessageSearchMatches(
    sources: CachedMessageSearchMatch[][],
    sessionOrder: string[],
    limit = 50,
    perSessionLimit = 10,
): CachedMessageSearchMatch[] {
    const bySession = new Map<string, Map<string, CachedMessageSearchMatch>>();
    for (const match of sources.flat()) {
        let messages = bySession.get(match.sessionId);
        if (!messages) {
            messages = new Map();
            bySession.set(match.sessionId, messages);
        }
        if (!messages.has(match.messageId)) messages.set(match.messageId, match);
    }

    const merged: CachedMessageSearchMatch[] = [];
    for (const sessionId of sessionOrder) {
        const messages = bySession.get(sessionId);
        if (!messages) continue;
        merged.push(...[...messages.values()].sort((a, b) => b.seq - a.seq).slice(0, perSessionLimit));
        if (merged.length >= limit) break;
    }
    return merged.slice(0, limit);
}

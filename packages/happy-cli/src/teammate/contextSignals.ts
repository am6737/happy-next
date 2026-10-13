import { TEAMMATE_ENV, type TeammateControllerProvider } from 'happy-wire';
import type { ApiClient } from '@/api/api';
import { mergeThreadState, readThreadsState } from './homeDir';

let usageTimer: ReturnType<typeof setTimeout> | undefined;
type ContextUsage = { contextTokens: number; contextWindow?: number; cachedTokens?: number; provider: TeammateControllerProvider; at: number };
let pendingUsage: ContextUsage[] = [];
let previousCallAt: number | undefined;
let previousCallKey: string | undefined;

export const PROVIDER_CACHE_TTL_MS: Record<TeammateControllerProvider | 'gemini', number> = { claude: 5 * 60_000, codex: 30 * 60_000, gemini: 5 * 60_000 };

function context(): { home: string; threadId: string } | undefined {
    if (process.env[TEAMMATE_ENV.sessionRole] !== 'controller') return undefined;
    const home = process.env[TEAMMATE_ENV.home];
    const threadId = process.env[TEAMMATE_ENV.threadId];
    return home && threadId ? { home, threadId } : undefined;
}

export function recordTeammateContextUsage(usage: { contextTokens: number; contextWindow?: number; cachedTokens?: number; provider: TeammateControllerProvider }): void {
    const current = context();
    if (!current) return;
    const key = `${current.home}:${current.threadId}`;
    if (previousCallKey !== key) { previousCallAt = undefined; previousCallKey = key; }
    pendingUsage.push({ ...usage, at: Date.now() });
    if (usageTimer) clearTimeout(usageTimer);
    usageTimer = setTimeout(() => {
        const values = pendingUsage;
        pendingUsage = [];
        usageTimer = undefined;
        if (values.length) void (async () => {
            const entry = (await readThreadsState(current.home))[current.threadId] ?? {};
            let previous = previousCallAt ?? entry.contextAt;
            let ttl = entry.cacheTtlMs;
            let observed = false;
            for (const value of values) {
                const gap = previous === undefined ? undefined : value.at - previous;
                if (gap !== undefined && gap >= 60_000) {
                    const baseline = ttl ?? PROVIDER_CACHE_TTL_MS[value.provider];
                    ttl = Math.max(60_000, Math.min(3_600_000, (value.cachedTokens ?? 0) >= 0.5 * value.contextTokens ? Math.max(baseline, gap) : Math.min(baseline, gap)));
                    observed = true;
                }
                previous = value.at;
            }
            previousCallAt = previous;
            const latest = values[values.length - 1];
            await mergeThreadState(current.home, current.threadId, {
                contextTokens: latest.contextTokens, contextWindow: latest.contextWindow ?? entry.contextWindow,
                cachedTokens: latest.cachedTokens ?? 0, contextAt: latest.at,
                segmentStartTokens: entry.segmentStartTokens ?? values[0].contextTokens,
                ...(observed ? { cacheTtlMs: ttl } : {}),
            });
        })().catch(() => {});
    }, 2000);
    usageTimer.unref?.();
}

export async function recordTeammateContextWindow(contextWindow: number): Promise<void> {
    const current = context();
    if (!current) return;
    const entry = await readThreadsState(current.home).catch(() => ({} as Awaited<ReturnType<typeof readThreadsState>>));
    if (entry[current.threadId]?.contextTokens === undefined) return;
    await mergeThreadState(current.home, current.threadId, { contextWindow });
}

export function isClaudeContextOverflow(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const value = result as { terminal_reason?: unknown; result?: unknown };
    if (value.terminal_reason === 'prompt_too_long') return true;
    if (typeof value.result !== 'string' || value.result.length > 320) return false;
    const text = value.result;
    return text.includes('Conversation too long. Press esc twice to go up a few messages and try again.')
        || text.includes('Compaction failed · conversation could not be reduced below the context limit')
        || (text.includes('cannot be compacted') && text.includes('Prompt is too long'));
}

export async function recordTeammateCompaction(api: Pick<ApiClient, 'reportTeammateContextEvent'>, provider: TeammateControllerProvider): Promise<void> {
    const current = context();
    if (!current) return;
    try {
        const entry = (await readThreadsState(current.home))[current.threadId];
        if (!entry?.lastRunId || !entry.lastDispatchToken) return;
        const compactions = (entry.compactions ?? 0) + 1;
        await mergeThreadState(current.home, current.threadId, { compactions });
        await api.reportTeammateContextEvent(entry.lastRunId, { code: 'context_compacted', dispatchToken: entry.lastDispatchToken, provider, compactions });
    } catch { /* provider hooks must never affect the session */ }
}

export async function recordTeammateOverflow(api: Pick<ApiClient, 'reportTeammateContextEvent'>, provider: TeammateControllerProvider): Promise<void> {
    const current = context();
    if (!current) return;
    try {
        const entry = (await readThreadsState(current.home))[current.threadId];
        if (!entry?.lastRunId || !entry.lastDispatchToken || entry.overflowed) return;
        await mergeThreadState(current.home, current.threadId, { overflowed: true });
        await api.reportTeammateContextEvent(entry.lastRunId, { code: 'context_lost', dispatchToken: entry.lastDispatchToken, provider, reason: 'overflow' });
    } catch { /* provider hooks must never affect the session */ }
}

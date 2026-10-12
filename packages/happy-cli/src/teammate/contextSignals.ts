import { TEAMMATE_ENV, type TeammateControllerProvider } from 'happy-wire';
import type { ApiClient } from '@/api/api';
import { mergeThreadState, readThreadsState } from './homeDir';

let usageTimer: ReturnType<typeof setTimeout> | undefined;
let latestUsage: { contextTokens: number; contextWindow?: number } | undefined;

function context(): { home: string; threadId: string } | undefined {
    if (process.env[TEAMMATE_ENV.sessionRole] !== 'controller') return undefined;
    const home = process.env[TEAMMATE_ENV.home];
    const threadId = process.env[TEAMMATE_ENV.threadId];
    return home && threadId ? { home, threadId } : undefined;
}

export function recordTeammateContextUsage(usage: { contextTokens: number; contextWindow?: number }): void {
    const current = context();
    if (!current) return;
    latestUsage = usage;
    if (usageTimer) clearTimeout(usageTimer);
    usageTimer = setTimeout(() => {
        const value = latestUsage;
        latestUsage = undefined;
        usageTimer = undefined;
        if (value) void mergeThreadState(current.home, current.threadId, value).catch(() => {});
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

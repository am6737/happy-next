import { messageMatchesSearchQuery, messageSearchSnippet, normalizeMessageSearchText } from 'happy-wire';
import type { NormalizedMessage } from '../typesRaw';

export type CachedMessageSearchEntry = {
    id: string;
    role: 'user' | 'agent';
    text: string;
    createdAt: number;
    normalizedText: string;
    seq: number;
};

export type CachedMessageSearchMatch = {
    sessionId: string;
    snippet: string;
    // The matched message, so opening the hit can scroll to it
    messageId: string;
    role: 'user' | 'agent';
    seq: number;
    createdAt: number;
};

// Shared with the CLI's message archive, so local and machine search find and quote the same messages
export const normalizeCachedMessageSearchText = normalizeMessageSearchText;

export function extractCachedMessageText(message: NormalizedMessage): string | null {
    if (message.isSidechain) return null;

    if (message.role === 'user') {
        // A post-compaction summary repeats the whole conversation, so it would match nearly every query
        if (message.meta?.isCompactSummary) return null;
        return message.content.text.trim() || null;
    }
    if (message.role !== 'agent') return null;

    const parts = message.content.flatMap((item) => item.type === 'text' ? [item.text] : []);
    const text = parts.join('\n').trim();
    return text || null;
}

// Codex and ACP reasoning normalizes to the same text items as a reply, so it is told apart on the
// raw record. Machine message archives leave it out, and local search does too, so both find the same messages.
export function isReasoningRecord(raw: unknown): boolean {
    const { role, content } = (raw ?? {}) as { role?: unknown; content?: any };
    return role === 'agent' && (content?.type === 'codex' || content?.type === 'acp') && content.data?.type === 'reasoning';
}

export const cachedMessageMatchesQuery = messageMatchesSearchQuery;

export const cachedMessageSnippet = messageSearchSnippet;

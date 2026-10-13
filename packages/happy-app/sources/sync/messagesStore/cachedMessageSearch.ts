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

export function normalizeCachedMessageSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

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

export function cachedMessageMatchesQuery(normalizedText: string, rawQuery: string): boolean {
    const tokens = normalizeCachedMessageSearchText(rawQuery).split(' ').filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

// Drops markdown and tag syntax so a snippet reads as plain prose instead of `**`, backticks and <options> markup
function plainSnippetText(text: string): string {
    return text
        .replace(/```[^\n]*\n?/g, '')
        .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/(\*\*|__|`)/g, '');
}

export function cachedMessageSnippet(text: string, rawQuery: string, maxLength = 150): string {
    const compact = plainSnippetText(text).replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;

    const normalized = normalizeCachedMessageSearchText(compact);
    const firstToken = normalizeCachedMessageSearchText(rawQuery).split(' ').find(Boolean) ?? '';
    const matchIndex = firstToken ? normalized.indexOf(firstToken) : 0;
    const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), compact.length - maxLength));
    const slice = compact.slice(start, start + maxLength).trim();
    return `${start > 0 ? '…' : ''}${slice}${start + maxLength < compact.length ? '…' : ''}`;
}

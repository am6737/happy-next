import type { NormalizedMessage } from '../typesRaw';

export type CachedMessageSearchEntry = {
    text: string;
    normalizedText: string;
    seq: number;
};

export type CachedMessageSearchMatch = {
    sessionId: string;
    snippet: string;
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
        return message.content.text.trim() || null;
    }
    if (message.role !== 'agent') return null;

    const parts = message.content.flatMap((item) => {
        if (item.type === 'text') return [item.text];
        if (item.type === 'summary') return [item.summary];
        return [];
    });
    const text = parts.join('\n').trim();
    return text || null;
}

export function cachedMessageMatchesQuery(normalizedText: string, rawQuery: string): boolean {
    const tokens = normalizeCachedMessageSearchText(rawQuery).split(' ').filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

export function cachedMessageSnippet(text: string, rawQuery: string, maxLength = 150): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;

    const normalized = normalizeCachedMessageSearchText(compact);
    const firstToken = normalizeCachedMessageSearchText(rawQuery).split(' ').find(Boolean) ?? '';
    const matchIndex = firstToken ? normalized.indexOf(firstToken) : 0;
    const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), compact.length - maxLength));
    const slice = compact.slice(start, start + maxLength).trim();
    return `${start > 0 ? '…' : ''}${slice}${start + maxLength < compact.length ? '…' : ''}`;
}

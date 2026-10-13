import { z } from 'zod';

// Message search, shared by the app (over its local message cache) and the CLI (over the per-session
// message archive it keeps under ~/.happy-next/messages), so both find and quote the same messages.

export type MessageSearchRole = 'user' | 'agent';

export function normalizeMessageSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Every whitespace-separated token of the query must appear in the message. */
export function messageMatchesSearchQuery(normalizedText: string, rawQuery: string): boolean {
    const tokens = normalizeMessageSearchText(rawQuery).split(' ').filter(Boolean);
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

export function messageSearchSnippet(text: string, rawQuery: string, maxLength = 150): string {
    const compact = plainSnippetText(text).replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;

    const normalized = normalizeMessageSearchText(compact);
    const firstToken = normalizeMessageSearchText(rawQuery).split(' ').find(Boolean) ?? '';
    const matchIndex = firstToken ? normalized.indexOf(firstToken) : 0;
    const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), compact.length - maxLength));
    const slice = compact.slice(start, start + maxLength).trim();
    return `${start > 0 ? '…' : ''}${slice}${start + maxLength < compact.length ? '…' : ''}`;
}

/**
 * The searchable text of a message as the CLI sends it (before encryption): what the user typed and
 * what the agent replied in prose. Tool calls, tool output, thinking, subagent traffic, plan updates
 * and Claude's post-compaction summary are left out — the summary repeats the whole conversation,
 * so it would match nearly every query.
 */
export function extractSearchableMessage(message: unknown): { role: MessageSearchRole; text: string } | null {
    const record = message as { role?: unknown; content?: any; meta?: any } | null;
    if (!record || typeof record !== 'object') return null;

    if (record.role === 'user') {
        if (record.meta?.isCompactSummary) return null;
        const text = typeof record.content?.text === 'string' ? record.content.text.trim() : '';
        return text ? { role: 'user', text } : null;
    }
    if (record.role !== 'agent') return null;

    const { type, data } = record.content ?? {};
    let text = '';
    if (type === 'output' && data?.type === 'assistant' && !data.isSidechain && !data.isMeta && !data.isCompactSummary) {
        const blocks: any[] = Array.isArray(data.message?.content) ? data.message.content : [];
        text = blocks.flatMap((block) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n');
    } else if ((type === 'codex' || type === 'acp') && data?.type === 'message' && typeof data.message === 'string' && !data.message.startsWith('[Plan Update]')) {
        text = data.message;
    }
    text = text.trim();
    return text ? { role: 'agent', text } : null;
}

//
// Message archive: ~/.happy-next/messages/<sessionId>.jsonl
//
// One JSON object per line; JSON escapes the newlines inside a message, so a message of any length
// stays on its line. The first line is the header, holding what never changes about the session —
// readers ignore fields they don't know, so new header fields can be added without a format bump.
//

export const MESSAGE_ARCHIVE_VERSION = 1;

export const messageArchiveHeaderSchema = z.object({
    type: z.literal('header'),
    v: z.number(),
    sessionId: z.string(),
    machineId: z.string().nullable(),
    agent: z.string().nullable(),
    path: z.string(),
    host: z.string(),
    createdAt: z.number(),
});
export type MessageArchiveHeader = z.infer<typeof messageArchiveHeaderSchema>;

export const messageArchiveEntrySchema = z.object({
    type: z.literal('message'),
    role: z.enum(['user', 'agent']),
    text: z.string(),
    id: z.string(),
    seq: z.number(),
    localId: z.string().nullable(),
    createdAt: z.number(),
});
export type MessageArchiveEntry = z.infer<typeof messageArchiveEntrySchema>;

//
// search-messages machine RPC
//

export const searchMessagesRequestSchema = z.object({
    query: z.string(),
    limit: z.number().int().positive().max(500).optional(),
    perSessionLimit: z.number().int().positive().max(100).optional(),
});
export type SearchMessagesRequest = z.infer<typeof searchMessagesRequestSchema>;

export const messageSearchHitSchema = z.object({
    sessionId: z.string(),
    id: z.string(),
    seq: z.number(),
    localId: z.string().nullable(),
    role: z.enum(['user', 'agent']),
    snippet: z.string(),
    createdAt: z.number(),
});
export type MessageSearchHit = z.infer<typeof messageSearchHitSchema>;

export const searchMessagesResponseSchema = z.object({
    hits: z.array(messageSearchHitSchema),
});
export type SearchMessagesResponse = z.infer<typeof searchMessagesResponseSchema>;

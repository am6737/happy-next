import { describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '../typesRaw';
import {
    cachedMessageMatchesQuery,
    cachedMessageSnippet,
    extractCachedMessageText,
    isReasoningRecord,
    normalizeCachedMessageSearchText,
} from './cachedMessageSearch';

describe('cached message search helpers', () => {
    it('extracts visible user and agent text while ignoring sidechains and thinking', () => {
        const user = {
            role: 'user',
            content: { type: 'text', text: 'Search this prompt' },
            isSidechain: false,
        } as NormalizedMessage;
        const agent = {
            role: 'agent',
            content: [
                { type: 'thinking', thinking: 'secret reasoning' },
                { type: 'text', text: 'Visible answer' },
                { type: 'summary', summary: 'Useful summary' },
            ],
            isSidechain: false,
        } as NormalizedMessage;

        expect(extractCachedMessageText(user)).toBe('Search this prompt');
        expect(extractCachedMessageText(agent)).toBe('Visible answer');
        expect(extractCachedMessageText({ ...user, isSidechain: true })).toBeNull();
        expect(extractCachedMessageText({ ...user, meta: { isCompactSummary: true } } as NormalizedMessage)).toBeNull();
    });

    it('tells Codex and ACP reasoning apart from replies', () => {
        expect(isReasoningRecord({ role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'hmm' } } })).toBe(true);
        expect(isReasoningRecord({ role: 'agent', content: { type: 'acp', provider: 'gemini', data: { type: 'reasoning', message: 'hmm' } } })).toBe(true);
        expect(isReasoningRecord({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'done' } } })).toBe(false);
        expect(isReasoningRecord({ role: 'user', content: { type: 'text', text: 'reasoning' } })).toBe(false);
    });

    it('normalizes text and requires every query token', () => {
        const text = normalizeCachedMessageSearchText('Résumé for Command Palette');
        expect(cachedMessageMatchesQuery(text, 'resume palette')).toBe(true);
        expect(cachedMessageMatchesQuery(text, 'resume missing')).toBe(false);
    });

    it('builds a compact snippet around the match', () => {
        const text = `${'prefix '.repeat(30)}important phrase ${'suffix '.repeat(30)}`;
        const snippet = cachedMessageSnippet(text, 'important', 80);
        expect(snippet).toContain('important phrase');
        expect(snippet.length).toBeLessThanOrEqual(82);
    });

    it('strips markdown and tags from the snippet', () => {
        const text = '**Done** — `yarn typecheck` passes.\n- see [docs](https://x.y)\n<options><option>Commit</option></options>';
        expect(cachedMessageSnippet(text, 'docs')).toBe('Done — yarn typecheck passes. see docs Commit');
    });
});

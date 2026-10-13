import { describe, expect, it } from 'vitest';
import { extractSearchableMessage, messageMatchesSearchQuery, normalizeMessageSearchText } from './messageSearch';

describe('extractSearchableMessage', () => {
    it('keeps what the user typed', () => {
        expect(extractSearchableMessage({ role: 'user', content: { type: 'text', text: ' hello\nworld ' }, meta: { sentFrom: 'cli' } }))
            .toEqual({ role: 'user', text: 'hello\nworld' });
    });

    it('leaves out the post-compaction summary', () => {
        expect(extractSearchableMessage({ role: 'user', content: { type: 'text', text: 'summary' }, meta: { isCompactSummary: true } })).toBeNull();
    });

    it('joins the text blocks of a Claude reply and drops the rest', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'one' }, { type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'two' }] },
                },
            },
        };
        expect(extractSearchableMessage(message)).toEqual({ role: 'agent', text: 'one\ntwo' });
    });

    it('drops subagent replies and tool results', () => {
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'output', data: { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'x' }] } } } })).toBeNull();
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'output', data: { type: 'user', message: { content: [{ type: 'tool_result' }] } } } })).toBeNull();
    });

    it('keeps Codex and ACP replies but not reasoning or plan updates', () => {
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'done' } } })).toEqual({ role: 'agent', text: 'done' });
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'acp', provider: 'gemini', data: { type: 'message', message: 'ok' } } })).toEqual({ role: 'agent', text: 'ok' });
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'acp', provider: 'gemini', data: { type: 'reasoning', message: 'ok' } } })).toBeNull();
        expect(extractSearchableMessage({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: '[Plan Update] {}' } } })).toBeNull();
    });
});

describe('messageMatchesSearchQuery', () => {
    it('needs every token, ignoring case and accents', () => {
        const text = normalizeMessageSearchText('Déployer le TOKEN');
        expect(messageMatchesSearchQuery(text, 'deployer token')).toBe(true);
        expect(messageMatchesSearchQuery(text, 'deployer secret')).toBe(false);
    });
});

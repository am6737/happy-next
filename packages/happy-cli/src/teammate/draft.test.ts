import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@/claude/sdk/types';
import { buildTeammateDraftPrompt, generateTeammateDraft, parseTeammateDraftResult } from './draft';

const DRAFT = { name: 'Reviewer', handle: 'reviewer', role: 'Reviews PRs', skills: [], instructions: 'Review carefully.', avatar: { emoji: '🔍', color: '#5B6EF5' } };

function block(value: unknown): string {
    return `Here is a draft.\n<teammate_draft>${JSON.stringify(value)}</teammate_draft>`;
}

function fakeQuery(messages: SDKMessage[]) {
    const calls: unknown[] = [];
    const fn = ((config: unknown) => {
        calls.push(config);
        return (async function* () { yield* messages; })();
    }) as unknown as Parameters<typeof generateTeammateDraft>[1] extends { query?: infer Q } ? NonNullable<Q> : never;
    return { fn, calls };
}

describe('parseTeammateDraftResult', () => {
    it('reads the draft and questions', () => {
        const result = parseTeammateDraftResult(block({ draft: DRAFT, questions: [{ question: 'Which repo?', suggestions: ['a/b', 'c/d'] }] }));
        expect(result).toEqual({ draft: DRAFT, questions: [{ question: 'Which repo?', suggestions: ['a/b', 'c/d'] }] });
    });

    it('accepts a bare legacy draft without questions', () => {
        expect(parseTeammateDraftResult(block(DRAFT))).toEqual({ draft: DRAFT, questions: [] });
    });

    it('repairs raw newlines inside strings', () => {
        const raw = '<teammate_draft>{"draft":{"name":"A","handle":"a1","role":"r","skills":[],"instructions":"# Mission\nShip it.\tNow"}}</teammate_draft>';
        expect(parseTeammateDraftResult(raw)?.draft.instructions).toBe('# Mission\nShip it.\tNow');
    });

    it('uses the last block', () => {
        const text = `${block({ draft: { ...DRAFT, name: 'First' } })}\n${block({ draft: { ...DRAFT, name: 'Second' } })}`;
        expect(parseTeammateDraftResult(text)?.draft.name).toBe('Second');
    });

    it('falls back to fenced JSON', () => {
        expect(parseTeammateDraftResult(`Sure:\n\`\`\`json\n${JSON.stringify({ draft: DRAFT })}\n\`\`\``)?.draft.name).toBe('Reviewer');
    });

    it('sanitizes handle, color, skills and questions', () => {
        const result = parseTeammateDraftResult(block({
            draft: { ...DRAFT, name: 'Doc Writer', handle: '!!', skills: ['JS', 'js', '', 1, 'a', 'b', 'c', 'd', 'e', 'f', 'g'], avatar: { emoji: '📝', color: 'blue' } },
            questions: [
                { question: ' Repo? ', suggestions: ['A', 'a', 'B', 'C', 'D', 'E'] },
                { question: '', suggestions: ['x'] },
                { question: 'Q2' }, { question: 'Q3' }, { question: 'Q4' },
            ],
        }));
        expect(result?.draft.handle).toBe('doc-writer');
        expect(result?.draft.avatar).toEqual({ emoji: '📝', color: undefined });
        expect(result?.draft.skills).toEqual([]);
        expect(result?.questions).toEqual([
            { question: 'Repo?', suggestions: ['A', 'B', 'C', 'D'] },
            { question: 'Q2', suggestions: [] },
            { question: 'Q3', suggestions: [] },
        ]);
    });

    it('falls back to "agent" when no handle can be derived', () => {
        expect(parseTeammateDraftResult(block({ draft: { ...DRAFT, name: '审阅者', handle: '审阅' } }))?.draft.handle).toBe('agent');
    });

    it('returns null for unreadable or empty replies', () => {
        expect(parseTeammateDraftResult('no json here')).toBeNull();
        expect(parseTeammateDraftResult(block({ draft: { handle: 'x' } }))).toBeNull();
    });
});

describe('buildTeammateDraftPrompt', () => {
    it('includes locale, answers, previous draft and feedback', () => {
        const { systemPrompt, userPrompt } = buildTeammateDraftPrompt({
            description: 'reviews my PRs',
            locale: 'zh-Hans',
            answers: [{ question: 'Which repo?', answer: 'a/b' }],
            previous: DRAFT,
            feedback: 'be stricter',
        });
        expect(systemPrompt).toContain('<teammate_draft>');
        expect(userPrompt).toContain('reviews my PRs');
        expect(userPrompt).toContain('Locale: zh-Hans');
        expect(userPrompt).toContain('1. Q: Which repo?\n   A: a/b');
        expect(userPrompt).toContain(JSON.stringify(DRAFT));
        expect(userPrompt).toContain('be stricter');
    });
});

describe('generateTeammateDraft', () => {
    it('runs one tool-less turn and parses the reply', async () => {
        const { fn, calls } = fakeQuery([
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: block({ draft: DRAFT, questions: [] }) }] } } as SDKMessage,
            { type: 'result', subtype: 'success', is_error: false, result: '' } as SDKMessage,
        ]);
        await expect(generateTeammateDraft({ description: 'x' }, { query: fn })).resolves.toEqual({ draft: DRAFT, questions: [] });
        const options = (calls[0] as { options: Record<string, unknown> }).options;
        expect(options.maxTurns).toBe(1);
        expect(options.strictMcpConfig).toBe(true);
        expect(options.canCallTool).toBeUndefined();
        expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'WebFetch']));
    });

    it('throws when the reply cannot be parsed', async () => {
        const { fn } = fakeQuery([{ type: 'result', subtype: 'success', is_error: false, result: 'sorry' } as SDKMessage]);
        await expect(generateTeammateDraft({ description: 'x' }, { query: fn })).rejects.toThrow('could not be read');
    });

    it('surfaces Claude errors', async () => {
        const { fn } = fakeQuery([{ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Not logged in' } as SDKMessage]);
        await expect(generateTeammateDraft({ description: 'x' }, { query: fn })).rejects.toThrow('Not logged in');
    });
});

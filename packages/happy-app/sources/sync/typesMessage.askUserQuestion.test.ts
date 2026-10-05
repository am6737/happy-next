import { describe, expect, it } from 'vitest';
import {
    buildAskUserQuestionMessage,
    normalizeAskUserQuestionAnswers,
    parseAskUserQuestionPrompts,
    readAskUserQuestionAnswer,
    toAskUserQuestionMessage,
    ToolCallMessage,
} from './typesMessage';

const INPUT = {
    questions: [
        {
            id: 'db',
            header: 'Database',
            question: 'Which database should we use?',
            options: [{ label: 'Postgres', description: 'Relational' }],
            multiSelect: false,
        },
        {
            header: 'Cache',
            question: 'Which cache?',
            options: [],
            multiSelect: false,
            isSecret: true,
        },
    ],
};

function toolCallMessage(tool: Partial<ToolCallMessage['tool']>): ToolCallMessage {
    return {
        kind: 'tool-call',
        id: 'm1',
        localId: null,
        createdAt: 1700000000000,
        seq: 12,
        tool: {
            name: 'AskUserQuestion',
            state: 'completed',
            input: INPUT,
            createdAt: 1700000000000,
            startedAt: 1700000000000,
            completedAt: 1700000001000,
            description: null,
            ...tool,
        } as ToolCallMessage['tool'],
        children: [],
    };
}

describe('parseAskUserQuestionPrompts', () => {
    it('keeps only the fields the minimap renders', () => {
        expect(parseAskUserQuestionPrompts(INPUT)).toEqual([
            { id: 'db', header: 'Database', question: 'Which database should we use?' },
            { header: 'Cache', question: 'Which cache?', isSecret: true },
        ]);
    });

    it('returns [] for malformed or empty input instead of throwing', () => {
        expect(parseAskUserQuestionPrompts(undefined)).toEqual([]);
        expect(parseAskUserQuestionPrompts('nope')).toEqual([]);
        expect(parseAskUserQuestionPrompts({ questions: 'nope' })).toEqual([]);
        expect(parseAskUserQuestionPrompts({ questions: [null, {}, { question: 42 }] })).toEqual([]);
    });
});

describe('normalizeAskUserQuestionAnswers', () => {
    it('drops non-string and empty entries, collapsing an empty map to null', () => {
        expect(normalizeAskUserQuestionAnswers({ db: 'Postgres', other: '', n: 3 })).toEqual({ db: 'Postgres' });
        expect(normalizeAskUserQuestionAnswers({})).toBeNull();
        expect(normalizeAskUserQuestionAnswers(null)).toBeNull();
        expect(normalizeAskUserQuestionAnswers(['Postgres'])).toBeNull();
    });
});

describe('buildAskUserQuestionMessage', () => {
    it('returns null when the payload carries no question', () => {
        expect(buildAskUserQuestionMessage({
            id: 'm1',
            localId: null,
            createdAt: 1,
            input: { questions: [] },
        })).toBeNull();
    });

    it('prefers permission answers over the tool result', () => {
        const message = buildAskUserQuestionMessage({
            id: 'm1',
            localId: null,
            createdAt: 1,
            seq: 12,
            input: INPUT,
            permissionAnswers: { db: 'Postgres' },
            result: { answers: { db: 'MySQL' } },
        });
        expect(message?.answers).toEqual({ db: 'Postgres' });
        expect(message).toMatchObject({ kind: 'ask-user-question', id: 'm1', seq: 12 });
    });

    it('falls back to answers carried only by the tool result (historical payloads)', () => {
        const message = buildAskUserQuestionMessage({
            id: 'm1',
            localId: null,
            createdAt: 1,
            input: INPUT,
            result: { answers: { db: 'MySQL' } },
        });
        expect(message?.answers).toEqual({ db: 'MySQL' });
    });

    it('ignores a non-object result', () => {
        const message = buildAskUserQuestionMessage({
            id: 'm1',
            localId: null,
            createdAt: 1,
            input: INPUT,
            result: 'error: tool failed',
        });
        expect(message?.answers).toBeNull();
    });
});

describe('toAskUserQuestionMessage', () => {
    it('reads questions and answers off a reduced tool call', () => {
        const message = toAskUserQuestionMessage(toolCallMessage({
            permission: { id: 'p1', status: 'approved', answers: { db: 'Postgres' } },
        }));
        expect(message?.questions).toHaveLength(2);
        expect(message?.answers).toEqual({ db: 'Postgres' });
    });

    it('returns null for an AskUserQuestion call with an unparseable payload', () => {
        expect(toAskUserQuestionMessage(toolCallMessage({ input: {} }))).toBeNull();
    });
});

describe('readAskUserQuestionAnswer', () => {
    const question = { id: 'db', header: 'Database', question: 'Which database should we use?' };

    it('resolves an answer by id, then question text, then header', () => {
        expect(readAskUserQuestionAnswer({ db: 'by id' }, question)).toBe('by id');
        expect(readAskUserQuestionAnswer({ 'Which database should we use?': 'by text' }, question)).toBe('by text');
        expect(readAskUserQuestionAnswer({ Database: 'by header' }, question)).toBe('by header');
        expect(readAskUserQuestionAnswer({ other: 'nope' }, question)).toBeUndefined();
    });

    it('masks a secret answer instead of echoing it back', () => {
        expect(readAskUserQuestionAnswer({ Cache: 'hunter2' }, { header: 'Cache', question: 'Which cache?', isSecret: true }))
            .toBe('********');
    });
});

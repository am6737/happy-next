import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { changedDraftFields, generateTeammateDraft, mergeDraftAnswers, putTeammateSeed, takeTeammateSeed } from './teammateDraft';

const DRAFT = { name: 'A', handle: 'a1', role: 'r', skills: [], instructions: '' };

describe('teammate draft', () => {
    beforeEach(() => machineRPC.mockReset());

    it('hands a seed over exactly once', () => {
        const seed = { machineId: 'm1', draft: DRAFT };
        const key = putTeammateSeed(seed);
        expect(takeTeammateSeed(key)).toEqual(seed);
        expect(takeTeammateSeed(key)).toBeUndefined();
    });

    it('returns the draft with its questions', async () => {
        const questions = [{ question: 'Which repo?', suggestions: ['a/b'] }];
        machineRPC.mockResolvedValue({ ok: true, draft: DRAFT, questions });
        await expect(generateTeammateDraft('m1', { description: 'x' })).resolves.toEqual({ draft: DRAFT, questions });
        expect(machineRPC).toHaveBeenCalledWith('m1', 'teammate-draft', { description: 'x' }, expect.any(Number));
    });

    it('defaults missing questions to none', async () => {
        machineRPC.mockResolvedValue({ ok: true, draft: DRAFT });
        await expect(generateTeammateDraft('m1', { description: 'x' })).resolves.toEqual({ draft: DRAFT, questions: [] });
    });

    it('surfaces CLI errors and malformed replies', async () => {
        machineRPC.mockResolvedValue({ ok: false, error: 'Not logged in' });
        await expect(generateTeammateDraft('m1', { description: 'x' })).rejects.toThrow('Not logged in');
        machineRPC.mockResolvedValue({ ok: true });
        await expect(generateTeammateDraft('m1', { description: 'x' })).rejects.toThrow('teammates.ai.invalidResponse');
    });

    it('asks to update the CLI when the method is missing', async () => {
        machineRPC.mockRejectedValue(new Error('RPC method not available'));
        await expect(generateTeammateDraft('m1', { description: 'x' })).rejects.toThrow('teammates.ai.updateCli');
        machineRPC.mockResolvedValue({ error: 'Method not found' });
        await expect(generateTeammateDraft('m1', { description: 'x' })).rejects.toThrow('teammates.ai.updateCli');
    });
});

describe('mergeDraftAnswers', () => {
    const questions = [{ question: 'Q1', suggestions: [] }, { question: 'Q2', suggestions: [] }, { question: 'Q3', suggestions: [] }];

    it('appends answered questions in order and leaves out skipped or blank ones', () => {
        const previous = [{ question: 'Q0', answer: 'A0' }];
        expect(mergeDraftAnswers(previous, questions, ['A1', undefined, '  A3 '])).toEqual([
            { question: 'Q0', answer: 'A0' }, { question: 'Q1', answer: 'A1' }, { question: 'Q3', answer: 'A3' },
        ]);
        expect(mergeDraftAnswers(previous, questions, [' ', undefined])).toEqual(previous);
    });

    it('keeps only the newest 20 answers', () => {
        const previous = Array.from({ length: 19 }, (_, index) => ({ question: `P${index}`, answer: 'x' }));
        const merged = mergeDraftAnswers(previous, questions, ['A1', 'A2']);
        expect(merged).toHaveLength(20);
        expect(merged[0].question).toBe('P1');
        expect(merged[19]).toEqual({ question: 'Q2', answer: 'A2' });
    });
});

describe('changedDraftFields', () => {
    it('reports nothing on the first round and compares skills by value', () => {
        expect(changedDraftFields(undefined, DRAFT)).toEqual([]);
        expect(changedDraftFields(DRAFT, { ...DRAFT, skills: [] })).toEqual([]);
        expect(changedDraftFields(DRAFT, { ...DRAFT, role: 'r2', instructions: 'new', handle: 'b2' })).toEqual(['role', 'instructions']);
    });
});

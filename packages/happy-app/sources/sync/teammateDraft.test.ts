import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { generateTeammateDraft, putTeammateSeed, takeTeammateSeed } from './teammateDraft';

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

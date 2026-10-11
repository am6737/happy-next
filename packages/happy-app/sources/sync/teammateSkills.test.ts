import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));

import { listTeammateSkills } from './teammateSkills';

const SKILL = { name: 'review', description: 'Review code', source: 'claude', scope: 'USER', path: '/home/u/.claude/skills/review/SKILL.md' };

describe('listTeammateSkills', () => {
    beforeEach(() => { machineRPC.mockReset(); });

    it('returns the machine skills', async () => {
        machineRPC.mockResolvedValue({ skills: [SKILL] });
        await expect(listTeammateSkills('m1')).resolves.toEqual({ status: 'ready', skills: [SKILL] });
        expect(machineRPC).toHaveBeenCalledWith('m1', 'teammate-list-skills', {}, expect.any(Number));
    });

    it('is unavailable when the RPC fails (offline machine or old CLI)', async () => {
        machineRPC.mockImplementation(async () => { throw new Error('RPC method not available'); });
        const result = await listTeammateSkills('m1');
        expect(result).toEqual({ status: 'unavailable' });
    });

    it('is unavailable when the response is malformed', async () => {
        machineRPC.mockResolvedValue({ skills: [{ name: 'x' }] });
        await expect(listTeammateSkills('m1')).resolves.toEqual({ status: 'unavailable' });
    });
});

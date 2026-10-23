import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({
    getSession: vi.fn(),
}));

vi.mock('./storage', () => ({
    getSession,
    storage: {
        getState: () => ({ sessionCapabilities: {} }),
    },
}));

import { searchSkills, sortSkillsByScope } from './suggestionSkills';

const skills = [
    { name: 'global', description: 'Global', scope: 'SYSTEM' as const, path: '/system/SKILL.md' },
    { name: 'personal-2', description: 'Personal 2', scope: 'USER' as const, path: '/user/2/SKILL.md' },
    { name: 'project', description: 'Project', scope: 'REPO' as const, path: '/repo/SKILL.md' },
    { name: 'personal-1', description: 'Personal 1', scope: 'USER' as const, path: '/user/1/SKILL.md' },
    { name: 'admin', description: 'Admin', scope: 'ADMIN' as const, path: '/etc/codex/skills/SKILL.md' },
];

describe('Codex skill scope grouping', () => {
    beforeEach(() => {
        getSession.mockReset();
        getSession.mockReturnValue({ metadata: { skills } });
    });

    it('groups project, personal, and global scopes in Codex order', () => {
        expect(sortSkillsByScope(skills).map((skill) => skill.name)).toEqual([
            'project',
            'personal-2',
            'personal-1',
            'global',
            'admin',
        ]);
    });

    it('leaves skill search relevance ordering unchanged', () => {
        expect(searchSkills('session', '').map((skill) => skill.scope)).toEqual([
            'SYSTEM',
            'USER',
            'REPO',
            'USER',
            'ADMIN',
        ]);
    });
});

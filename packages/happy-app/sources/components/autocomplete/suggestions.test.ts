import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCommands, searchSkills, searchFiles, sortSkillsByScope } = vi.hoisted(() => ({
    searchCommands: vi.fn(),
    searchSkills: vi.fn(),
    searchFiles: vi.fn(),
    sortSkillsByScope: vi.fn((skills: Array<{ scope: string }>) => {
        const order: Record<string, number> = { REPO: 0, USER: 1, ADMIN: 2, SYSTEM: 2 };
        return skills
            .map((skill, index) => ({ skill, index }))
            .sort((a, b) => order[a.skill.scope] - order[b.skill.scope] || a.index - b.index)
            .map(({ skill }) => skill);
    }),
}));

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    SkillSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({ searchCommands }));
vi.mock('@/sync/suggestionSkills', () => ({ searchSkills, sortSkillsByScope }));
vi.mock('@/sync/suggestionFile', () => ({ searchFiles }));
vi.mock('@/sync/sync', () => ({
    sync: { fetchSessionCapabilities: vi.fn() },
}));
vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            sessionCapabilities: {
                session: { capabilities: {} },
            },
        }),
    },
}));

import { getSuggestions } from './suggestions';

describe('getSuggestions', () => {
    beforeEach(() => {
        searchCommands.mockReset();
        searchSkills.mockReset();
        searchFiles.mockReset();
        searchCommands.mockResolvedValue([]);
        searchSkills.mockReturnValue([]);
        searchFiles.mockResolvedValue([]);
    });

    it('includes commands and skills when completing a slash query', async () => {
        searchCommands.mockResolvedValue([
            { command: 'compact', description: 'Compact conversation' },
        ]);
        searchSkills.mockReturnValue([
            {
                name: 'imagegen',
                description: 'Generate images',
                scope: 'SYSTEM',
                path: '/skills/imagegen/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '/');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual([
            '/compact',
            '$imagegen',
        ]);

        const skillElement = (suggestions[1].component as unknown as () => { props: Record<string, unknown> })();
        expect(skillElement.props.showSkillCategory).toBe(true);
    });

    it('only shows subcommands after a slash command and space', async () => {
        searchCommands.mockResolvedValue([
            { command: 'review base', description: 'Review against a base branch' },
            { command: 'review commit', description: 'Review a commit' },
        ]);
        searchSkills.mockReturnValue([
            {
                name: 'review-helper',
                description: 'Help with reviews',
                scope: 'SYSTEM',
                path: '/skills/review-helper/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '/review ');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual([
            '/review base',
            '/review commit',
        ]);
        expect(searchSkills).not.toHaveBeenCalled();
    });

    it('shows no suggestions for free-form command arguments without subcommands', async () => {
        const suggestions = await getSuggestions('session', '/custom argument');

        expect(suggestions).toEqual([]);
        expect(searchCommands).toHaveBeenCalledWith('session', 'custom argument');
        expect(searchSkills).not.toHaveBeenCalled();
    });

    it('keeps dollar completion limited to skills with the scope label', async () => {
        searchSkills.mockReturnValue([
            {
                name: 'imagegen',
                description: 'Generate images',
                scope: 'SYSTEM',
                path: '/skills/imagegen/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '$image');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['$imagegen']);
        expect(searchCommands).not.toHaveBeenCalled();

        const skillElement = (suggestions[0].component as unknown as () => { props: Record<string, unknown> })();
        expect(skillElement.props.showSkillCategory).toBeUndefined();
    });

    it('keeps project, personal, and global skill scopes attached to dollar suggestions', async () => {
        searchSkills.mockReturnValue([
            { name: 'global-skill', description: 'Global skill', scope: 'SYSTEM', path: '/system/SKILL.md' },
            { name: 'personal-skill', description: 'Personal skill', scope: 'USER', path: '/user/SKILL.md' },
            { name: 'project-skill', description: 'Project skill', scope: 'REPO', path: '/repo/SKILL.md' },
        ]);

        const suggestions = await getSuggestions('session', '$');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual([
            '$project-skill',
            '$personal-skill',
            '$global-skill',
        ]);
        expect(suggestions.map((suggestion) => {
            const element = (suggestion.component as unknown as () => { props: Record<string, unknown> })();
            return element.props.scope;
        })).toEqual(['REPO', 'USER', 'SYSTEM']);
    });

    it('keeps at-sign file mentions routed to file search', async () => {
        searchFiles.mockResolvedValue([
            { fileName: 'README.md', filePath: 'docs/', fullPath: 'docs/README.md', fileType: 'file' },
        ]);

        const suggestions = await getSuggestions('session', '@docs/');

        expect(searchFiles).toHaveBeenCalledWith('session', 'docs/', { limit: 50 });
        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['@docs/README.md']);
        expect(searchCommands).not.toHaveBeenCalled();
        expect(searchSkills).not.toHaveBeenCalled();
    });
});

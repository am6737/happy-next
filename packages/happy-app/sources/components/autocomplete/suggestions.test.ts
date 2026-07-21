import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCommands, searchSkills } = vi.hoisted(() => ({
    searchCommands: vi.fn(),
    searchSkills: vi.fn(),
}));

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    SkillSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({ searchCommands }));
vi.mock('@/sync/suggestionSkills', () => ({ searchSkills }));
vi.mock('@/sync/suggestionFile', () => ({ searchFiles: vi.fn() }));
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
        searchCommands.mockResolvedValue([]);
        searchSkills.mockReturnValue([]);
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
});

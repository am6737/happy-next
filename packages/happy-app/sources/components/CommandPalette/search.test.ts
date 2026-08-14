import { describe, expect, it } from 'vitest';
import type { Command } from './types';
import { applyCachedMessageMatches, groupCommands, normalizeCommandSearchText, scoreCommand } from './search';

const command = (overrides: Partial<Command>): Command => ({
    id: 'command',
    title: 'Open Settings',
    category: 'Navigation',
    action: () => {},
    ...overrides,
});

describe('command palette search', () => {
    it('normalizes accents, paths and casing', () => {
        expect(normalizeCommandSearchText('  Résumé/Foo_Bar  ')).toBe('resume foo bar');
    });

    it('ranks exact and prefix title matches above metadata matches', () => {
        const exact = command({ id: 'exact', title: 'Settings' });
        const prefix = command({ id: 'prefix', title: 'Settings Account' });
        const metadata = command({ id: 'metadata', title: 'Account', keywords: ['settings'] });

        expect(scoreCommand(exact, 'settings')).toBeGreaterThan(scoreCommand(prefix, 'settings'));
        expect(scoreCommand(prefix, 'settings')).toBeGreaterThan(scoreCommand(metadata, 'settings'));
    });

    it('supports fuzzy subsequence matching and multiple tokens', () => {
        expect(scoreCommand(command({ title: 'Orchestrator Runs' }), 'orch runs')).toBeGreaterThan(0);
        expect(scoreCommand(command({ title: 'Orchestrator Runs' }), 'orch missing')).toBe(0);
    });

    it('keeps full-search commands hidden only while the query is empty', () => {
        const recent = command({ id: 'recent', title: 'Recent', showWhenIdle: true });
        const archived = command({ id: 'archived', title: 'Archived project', showWhenIdle: false });

        expect(groupCommands([recent, archived], '').flatMap((group) => group.commands)).toEqual([recent]);
        expect(groupCommands([recent, archived], 'archived').flatMap((group) => group.commands)).toEqual([archived]);
    });

    it('orders idle categories and commands by configured priority', () => {
        const low = command({ id: 'low', title: 'Low', category: 'Second', categoryOrder: 2, priority: 1 });
        const high = command({ id: 'high', title: 'High', category: 'First', categoryOrder: 1, priority: 10 });
        const medium = command({ id: 'medium', title: 'Medium', category: 'First', categoryOrder: 1, priority: 5 });

        const groups = groupCommands([low, medium, high], '');
        expect(groups.map((group) => group.title)).toEqual(['First', 'Second']);
        expect(groups[0].commands.map((item) => item.id)).toEqual(['high', 'medium']);
    });

    it('orders searched categories by their strongest result', () => {
        const fuzzyEarlyCategory = command({ id: 'fuzzy', title: 'Set things', category: 'Early', categoryOrder: 1 });
        const exactLateCategory = command({ id: 'exact', title: 'Settings', category: 'Late', categoryOrder: 10 });

        expect(groupCommands([fuzzyEarlyCategory, exactLateCategory], 'settings').map((group) => group.title))
            .toEqual(['Late', 'Early']);
    });

    it('turns cached message hits into searchable session commands with snippets', () => {
        const session = command({ id: 'session-abc', sessionId: 'abc', title: 'Unrelated session', keywords: [] });
        const [matched] = applyCachedMessageMatches(
            [session],
            [{ sessionId: 'abc', snippet: 'The deployment token lives here' }],
            'deployment token',
            'Message',
        );

        expect(matched.subtitle).toBe('“The deployment token lives here”');
        expect(matched.badge).toBe('Message');
        expect(groupCommands([matched], 'deployment token').flatMap((group) => group.commands)).toContain(matched);
    });
});

import { describe, expect, it, vi } from 'vitest';
import { takeSessionMessageJump } from '@/sync/sessionMessageJump';
import type { Command } from './types';
import { buildMessageCategory, buildNavigationRows, groupCommands, isTileCategory, normalizeCommandSearchText, scoreCommand } from './search';

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

    const labels = { category: 'Messages', badge: 'Message', user: 'You', agent: 'AI', more: (n: number) => `+${n}` };
    const hit = (sessionId: string, n: number, role: 'user' | 'agent' = 'user') =>
        ({ sessionId, snippet: `hit ${n}`, messageId: `${sessionId}-${n}`, role, seq: n, createdAt: n });

    it('merges a lone hit into its session row and nests several under a heading', () => {
        const sessions = [
            command({ id: 'session-a', sessionId: 'a', title: 'A' }),
            command({ id: 'session-b', sessionId: 'b', title: 'B' }),
        ];
        const category = buildMessageCategory(
            sessions,
            [hit('a', 5), hit('a', 4, 'agent'), hit('a', 3), hit('a', 2), hit('b', 1, 'agent')],
            labels,
            new Set(),
            () => {},
        )!;

        expect(category.commands.map((c) => [c.layout ?? 'single', c.title, c.subtitle ?? null])).toEqual([
            ['messageGroup', 'A', null],
            ['messageHit', 'hit 5', null],
            ['messageHit', 'hit 4', null],
            ['messageHit', 'hit 3', null],
            ['messageMore', '+1', null],
            ['single', 'B', 'AI: hit 1'],
        ]);
        expect(category.commands[0].badge).toBe('4');
        expect(category.commands[2].author).toBe('AI');
    });

    it('shows every hit once a session is expanded', () => {
        const onExpand = vi.fn();
        const sessions = [command({ id: 'session-a', sessionId: 'a', title: 'A' })];
        const matches = [hit('a', 4), hit('a', 3), hit('a', 2), hit('a', 1)];
        const folded = buildMessageCategory(sessions, matches, labels, new Set(), onExpand)!;
        const more = folded.commands.find((c) => c.layout === 'messageMore')!;
        expect(more.keepOpen).toBe(true);
        more.action();
        expect(onExpand).toHaveBeenCalledWith('a');

        const expanded = buildMessageCategory(sessions, matches, labels, new Set(['a']), onExpand)!;
        expect(expanded.commands.filter((c) => c.layout === 'messageHit')).toHaveLength(4);
        expect(expanded.commands.some((c) => c.layout === 'messageMore')).toBe(false);
    });

    it('opens a hit at its message and a heading at the session end', () => {
        const open = vi.fn();
        const sessions = [command({ id: 'session-a', sessionId: 'a', action: open })];
        const [heading, first] = buildMessageCategory(sessions, [hit('a', 2), hit('a', 1)], labels, new Set(), () => {})!.commands;

        heading.action();
        expect(takeSessionMessageJump('a')).toBeNull();
        first.action();
        expect(open).toHaveBeenCalledTimes(2);
        expect(takeSessionMessageJump('a')).toEqual({ id: 'a-2', seq: 2 });
    });

    it('replaces the rows of sessions with message hits and ranks the hits as a category', () => {
        const sessions = [
            command({ id: 'session-a', sessionId: 'a', title: 'Deploy notes', category: 'Sessions' }),
            command({ id: 'session-b', sessionId: 'b', title: 'Deploy pipeline', category: 'Sessions' }),
        ];
        const messages = buildMessageCategory(sessions, [hit('a', 1)], labels, new Set(), () => {});
        const groups = groupCommands(sessions, 'deploy', messages);

        expect(groups.map((g) => g.title)).toEqual(['Messages', 'Sessions']);
        expect(groups[1].commands.map((c) => c.id)).toEqual(['session-b']);
    });

    it('groups fixed entries as tiles while idle and as a list while searching', () => {
        const quick = Array.from({ length: 5 }, (_, i) => command({ id: `quick-${i}`, title: `Quick ${i}`, category: 'Quick', categoryOrder: 0, tile: true }));
        const settings = command({ id: 'settings', title: 'Settings', category: 'Settings', categoryOrder: 5, tile: true, idleCategory: 'Quick' });
        const session = command({ id: 'session', title: 'Session', category: 'Sessions', categoryOrder: 2 });
        const all = [...quick, settings, session];

        const idle = groupCommands(all, '');
        expect(idle.map((group) => group.title)).toEqual(['Quick', 'Sessions']);
        expect(idle[0].commands.map((c) => c.id)).toContain('settings');
        expect(isTileCategory(idle[0], '')).toBe(true);
        expect(isTileCategory(idle[1], '')).toBe(false);
        expect(buildNavigationRows(idle, '', 4)).toEqual([[0, 1, 2, 3], [4, 5], [6]]);

        const searching = groupCommands(all, 'settings');
        expect(searching[0].title).toBe('Settings');
        expect(isTileCategory(searching[0], 'settings')).toBe(false);
    });
});

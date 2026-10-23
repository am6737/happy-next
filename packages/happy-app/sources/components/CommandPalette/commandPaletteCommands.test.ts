import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/machineUtils', () => ({
    isMachineOnline: (machine: { activeAt: number }) => machine.activeAt > 0,
}));

import type { Session } from '@/sync/storageTypes';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import { groupCommands } from './search';

function session(index: number, overrides: Partial<Session> = {}): Session {
    return {
        id: `session-${index}`,
        seq: index,
        createdAt: index,
        updatedAt: index,
        active: true,
        activeAt: index,
        metadata: {
            name: `Project ${index}`,
            path: `/work/project-${index}`,
            host: `machine-${index}`,
            worktreeBranchName: index === 8 ? 'feature/search-everything' : undefined,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        ...overrides,
    };
}

function build(overrides: Partial<Parameters<typeof buildCommandPaletteCommands>[0]> = {}) {
    return buildCommandPaletteCommands({
        sessions: [],
        machines: [],
        drafts: {},
        currentSessionId: null,
        dootaskConnected: false,
        experimentsEnabled: false,
        developerEnabled: false,
        desktopPlatform: null,
        navigate: vi.fn(),
        navigateToSession: vi.fn(),
        logout: vi.fn(),
        ...overrides,
    });
}

describe('command palette command registry', () => {
    it('keeps only recent sessions in the idle view but searches every session', () => {
        const sessions = Array.from({ length: 8 }, (_, index) => session(index + 1));
        const commands = build({ sessions });
        const idleSessionIds = groupCommands(commands, '')
            .flatMap((group) => group.commands)
            .filter((item) => item.id.startsWith('session-session-'))
            .map((item) => item.id);

        expect(idleSessionIds).toHaveLength(6);
        expect(groupCommands(commands, 'feature search everything')
            .flatMap((group) => group.commands)
            .map((item) => item.id))
            .toContain('session-session-8');
    });

    it('marks archived sessions and gives their drafts no boost', () => {
        const archived = session(1, { active: false, metadata: { name: 'Old', path: '/work/old', host: 'm', lifecycleState: 'archived' } });
        const live = session(2);
        const commands = build({
            sessions: [archived, live],
            drafts: { [archived.id]: { text: 'unsent' } as any },
        });
        const archivedCommand = commands.find((item) => item.id === `session-${archived.id}`)!;
        const liveCommand = commands.find((item) => item.id === `session-${live.id}`)!;

        expect(archivedCommand.badge).toBe('commandPalette.statusArchived');
        expect(archivedCommand.icon).toBe('archive-outline');
        expect(archivedCommand.priority).toBeLessThan(liveCommand.priority!);
    });

    it('adds integration and feature commands only when available', () => {
        const minimalIds = build().map((item) => item.id);
        expect(minimalIds).not.toContain('dootask');
        expect(minimalIds).not.toContain('settings-usage');
        expect(minimalIds).not.toContain('dev-menu');

        const fullIds = build({
            dootaskConnected: true,
            experimentsEnabled: true,
            developerEnabled: true,
        }).map((item) => item.id);
        expect(fullIds).toEqual(expect.arrayContaining([
            'dootask',
            'new-dootask-task',
            'new-dootask-project',
            'settings-usage',
            'dev-menu',
        ]));
    });

    it('shows platform-appropriate desktop shortcut labels', () => {
        const macCommands = build({ desktopPlatform: 'macos' });
        const windowsCommands = build({ desktopPlatform: 'windows' });

        expect(macCommands.find((item) => item.id === 'new-session')?.shortcut).toBe('⌘N');
        expect(windowsCommands.find((item) => item.id === 'new-session')?.shortcut).toBe('Ctrl+N');
        expect(windowsCommands.find((item) => item.id === 'settings')?.shortcut).toBe('Ctrl+,');
    });

    it('adds contextual actions for the current session and its machine', () => {
        const current = session(1, { metadata: { name: 'Current', path: '/work/current', host: 'mac', machineId: 'machine-1' } });
        const ids = build({ sessions: [current], currentSessionId: current.id }).map((item) => item.id);

        expect(ids).toEqual(expect.arrayContaining([
            'current-session-info',
            'current-session-files',
            'current-session-status',
            'current-session-commits',
            'current-session-browser',
            'current-session-sharing',
            'current-session-edit',
            'current-session-machine',
        ]));
    });

    it('keeps logout searchable, hidden by default, and marked dangerous', () => {
        const commands = build();
        const logout = commands.find((item) => item.id === 'sign-out');
        expect(logout).toMatchObject({ dangerous: true, showWhenIdle: false });
        expect(groupCommands(commands, '').flatMap((group) => group.commands)).not.toContain(logout);
        expect(groupCommands(commands, 'sign out').flatMap((group) => group.commands)).toContain(logout);
    });

    it('shows a session as folder, host and model, keeping the full path searchable', () => {
        const commands = build({
            sessions: [session(1, { metadata: { path: '/home/me/work/happy-next/', host: 'mac', flavor: 'claude', model: 'claude-opus-5-5' } as Session['metadata'] })],
        });
        const row = commands.find((command) => command.sessionId === 'session-1')!;
        expect(row.subtitle).toBe('happy-next · mac · opus-5-5');
        expect(row.timestamp).toBe(1);
        expect(groupCommands(commands, 'home me work').flatMap((group) => group.commands)).toContain(row);
    });
});

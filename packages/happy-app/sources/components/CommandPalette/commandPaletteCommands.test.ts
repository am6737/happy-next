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

    it('adds integration and feature commands only when available', () => {
        const minimalIds = build().map((item) => item.id);
        expect(minimalIds).not.toContain('new-artifact');
        expect(minimalIds).not.toContain('artifacts');
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
});

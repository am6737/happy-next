import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalInfo } from 'happy-wire';

const machineRPC = vi.fn();

vi.mock('@/sync/apiSocket', () => ({
    apiSocket: {
        machineRPC: (...args: unknown[]) => machineRPC(...args),
    },
}));

import { listMachineTerminals, normalizeTerminal, spawnTerminal } from './openTerminal';

function terminal(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
    return {
        id: 'term_1',
        cwd: '/Users/someone/project',
        size: { rows: 24, cols: 80 },
        exited: false,
        ...overrides,
    };
}

/** What an older daemon stored for a terminal started without a directory. */
const noDirectory = { cwd: undefined as unknown as string };

beforeEach(() => {
    machineRPC.mockReset();
});

describe('normalizeTerminal', () => {
    it('leaves a terminal that has a directory exactly as it is', () => {
        // The ordinary case must not be copied, so this costs nothing.
        const sent = terminal();
        expect(normalizeTerminal(sent)).toBe(sent);
    });

    it('stands in an empty directory for one the daemon never recorded', () => {
        const sent = { ...terminal(), ...noDirectory };
        expect(normalizeTerminal(sent)).toEqual({ ...sent, cwd: '' });
    });

    it('stands in for a directory that is not a string at all', () => {
        // The daemon is a separate program, so what it sends is not guaranteed
        // by anything this codebase's types promise.
        const sent = { ...terminal(), cwd: null as unknown as string };
        expect(normalizeTerminal(sent).cwd).toBe('');
    });

    it('keeps everything else about the terminal', () => {
        const sent = { ...terminal({ title: 'vim README.md', exited: true }), ...noDirectory };
        expect(normalizeTerminal(sent)).toMatchObject({
            id: 'term_1',
            title: 'vim README.md',
            exited: true,
            size: { rows: 24, cols: 80 },
        });
    });
});

describe('listMachineTerminals', () => {
    it('normalizes every terminal the daemon lists', async () => {
        machineRPC.mockResolvedValueOnce([{ ...terminal(), ...noDirectory }]);

        const tabs = await listMachineTerminals('machine-1');

        expect(tabs).toEqual([
            { machineId: 'machine-1', terminal: expect.objectContaining({ id: 'term_1', cwd: '' }) },
        ]);
    });

    it('leaves a directory the daemon did send alone', async () => {
        machineRPC.mockResolvedValueOnce([terminal({ cwd: '/srv/app' })]);

        const tabs = await listMachineTerminals('machine-1');

        expect(tabs[0]!.terminal.cwd).toBe('/srv/app');
    });
});

describe('spawnTerminal', () => {
    it('tells the daemon which directory to start in', async () => {
        // The daemon records what it is asked for, so a spawn that omits the
        // directory is how a terminal ends up on the machine with none.
        machineRPC.mockResolvedValueOnce(terminal());

        await spawnTerminal({ machineId: 'machine-1', cwd: '/srv/app' });

        expect(machineRPC).toHaveBeenCalledWith(
            'machine-1',
            'terminal-spawn',
            expect.objectContaining({ cwd: '/srv/app' }),
        );
    });
});

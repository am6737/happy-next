import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isTerminalTmuxAvailable,
    isTerminalId,
    terminalTmuxAttachArgs,
    terminalTmuxBinary,
    terminalTmuxEnvironment,
} from './terminalTmux';

const tmuxInstalled = spawnSync(terminalTmuxBinary(), ['-V']).status === 0;

describe('terminal ids as tmux session names', () => {
    it('accepts what the daemon generates', () => {
        expect(isTerminalId('term_mua05tz6_fr1sm4')).toBe(true);
    });

    it('rejects what tmux would read as target syntax', () => {
        expect(isTerminalId('term:0')).toBe(false);
        expect(isTerminalId('term name')).toBe(false);
        expect(isTerminalId('')).toBe(false);
    });
});

describe('the attach command', () => {
    it('creates the session when it is new and attaches when it is not', () => {
        const args = terminalTmuxAttachArgs({
            id: 'term_abc_123456',
            cwd: '/tmp/work',
            shell: '/bin/bash',
            args: ['--norc'],
            rows: 24,
            cols: 80,
        });

        expect(args).toContain('new-session');
        // -A is the whole trick: an id left over from before a restart attaches
        // to the shell still running under it instead of starting a new one.
        expect(args).toContain('-A');
        expect(args.slice(args.indexOf('-s'))).toEqual([
            '-s', 'term_abc_123456',
            '-x', '80',
            '-y', '24',
            '-c', '/tmp/work',
            '/bin/bash', '--norc',
        ]);
    });
});

describe('the tmux locale', () => {
    it('keeps a locale that already says UTF-8', () => {
        const env = terminalTmuxEnvironment({ LANG: 'zh_CN.UTF-8' });
        expect(env.LC_CTYPE).toBeUndefined();
    });

    it('supplies one when nothing does, which is how a daemon starts', () => {
        // tmux silently drops to a non-UTF-8 mode without this, and the shells
        // it runs are the ones that render CJK.
        const env = terminalTmuxEnvironment({ PATH: '/usr/bin' });
        expect(env.LC_CTYPE).toBe(process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8');
    });
});

describe.skipIf(!tmuxInstalled)('asking whether tmux is there', () => {
    it('does not go on saying no after one look, so installing it is enough', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'happy-probe-'));
        const previous = process.env.HAPPY_TERMINAL_TMUX_SOCKET;
        const restore = () => {
            if (previous === undefined) {
                delete process.env.HAPPY_TERMINAL_TMUX_SOCKET;
            } else {
                process.env.HAPPY_TERMINAL_TMUX_SOCKET = previous;
            }
        };

        try {
            // A socket path under a regular file: the probe cannot even write
            // its configuration there, which is what a machine without tmux
            // looks like from the inside.
            const blocked = join(dir, 'not-a-directory');
            writeFileSync(blocked, '');
            process.env.HAPPY_TERMINAL_TMUX_SOCKET = join(blocked, 'terminal.sock');

            expect(await isTerminalTmuxAvailable()).toBe(false);

            // Having said no once, it must not keep saying it. A daemon that
            // had already decided would go on running plain terminals after
            // tmux was installed, with nothing to say why.
            restore();
            expect(await isTerminalTmuxAvailable()).toBe(true);

            // And a yes is kept: asking again costs nothing.
            expect(await isTerminalTmuxAvailable()).toBe(true);
        } finally {
            restore();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

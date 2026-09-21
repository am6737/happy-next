/**
 * What a daemon restart costs a terminal.
 *
 * These run real shells under a real tmux on a socket of their own, so they
 * cannot adopt — or end — the terminals of a daemon running on this machine.
 * Where tmux is not installed the suite is skipped, which is the same
 * condition that turns durability off in production.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TerminalManager } from './terminalManager';
import { listTerminalSessions, terminalTmuxBinary } from './terminalTmux';
import type { TerminalInfo, TerminalState } from 'happy-wire';

const tmuxInstalled = spawnSync(terminalTmuxBinary(), ['-V']).status === 0;

function gridText(state: TerminalState): string {
    return state.grid
        .map((row) => row.map((cell) => cell.char).join('').trimEnd())
        .join('\n');
}

/** Polls the mirrored screen until `predicate` holds, or fails the test. */
async function waitForScreen(
    manager: TerminalManager,
    terminalId: string,
    predicate: (text: string) => boolean,
    timeoutMs = 8000,
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
        const state = await manager.getState(terminalId);
        last = gridText(state);
        if (predicate(last)) {
            return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Screen never matched. Last screen:\n${last}`);
}

describe.skipIf(!tmuxInstalled)('durable terminals', () => {
    let socketDir = '';
    let socket = '';
    const managers: TerminalManager[] = [];

    /** A manager on the suite's own tmux server, torn down after each test. */
    function newManager(): TerminalManager {
        const manager = new TerminalManager();
        managers.push(manager);
        return manager;
    }

    beforeAll(() => {
        socketDir = mkdtempSync(join(tmpdir(), 'happy-terminal-tmux-'));
        socket = join(socketDir, 'terminal.sock');
        process.env.HAPPY_TERMINAL_TMUX_SOCKET = socket;
    });

    afterEach(() => {
        for (const manager of managers.splice(0)) {
            manager.stop();
        }
    });

    afterAll(() => {
        spawnSync(terminalTmuxBinary(), ['-S', socket, 'kill-server']);
        rmSync(socketDir, { recursive: true, force: true });
        delete process.env.HAPPY_TERMINAL_TMUX_SOCKET;
    });

    async function startShell(manager: TerminalManager) {
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });
        // Waiting for the prompt, not merely for a screen: an empty grid is
        // "non-empty text" too, and it is what a mirror holds before anything
        // has been painted. Stopping on that would race the tmux client, which
        // creates the session only once it is up.
        await waitForScreen(manager, info.id, (text) => text.trim().length > 0);
        return info;
    }

    it('hands a running shell to the next daemon, screen and all', async () => {
        const before = newManager();
        const info = await startShell(before);
        await before.write(info.id, "export SURVIVAL_MARK=kept; printf 'BEFORE_RESTART\\n'\n");
        await waitForScreen(before, info.id, (text) => text.includes('BEFORE_RESTART'));

        // What a shutdown does: the worker is killed, and it detaches rather
        // than ends the shells. Nothing else about the daemon survives.
        before.stop();

        const after = newManager();
        const restored = (await after.list()).find((entry) => entry.id === info.id);
        expect(restored).toBeDefined();
        expect(restored!.exited).toBe(false);

        // tmux repaints the pane when a client attaches, so the mirror is
        // rebuilt from nothing and still shows what the shell had printed.
        const screen = await waitForScreen(after, info.id, (text) => text.includes('BEFORE_RESTART'));
        expect(screen).toContain('BEFORE_RESTART');

        // The stronger claim: this is the same shell, not a fresh one wearing
        // its name. A new shell would have nothing to expand here.
        await after.write(info.id, "printf 'MARK=%s\\n' \"$SURVIVAL_MARK\"\n");
        const echoed = await waitForScreen(after, info.id, (text) => text.includes('MARK=kept'));
        expect(echoed).toContain('MARK=kept');
    }, 30000);

    it('ends the shell when a terminal is closed, leaving nothing behind', async () => {
        const manager = newManager();
        const info = await startShell(manager);

        await manager.dispose(info.id);

        // A daemon starting afterwards has nothing to take back, because the
        // shell is gone rather than merely detached.
        const next = newManager();
        expect((await next.list()).map((entry) => entry.id)).not.toContain(info.id);
    }, 30000);

    it('refuses to attach to a shell that ended after it was listed', async () => {
        const before = newManager();
        const info = await startShell(before);
        before.stop();

        const after = newManager();
        expect((await after.list()).map((entry) => entry.id)).toContain(info.id);

        // The shell goes away in the window between the listing and the first
        // look at it. Attaching with `new-session -A` would happily start a
        // fresh shell here, which is the one outcome worth refusing: a tab that
        // comes back as a different shell is worse than one that admits it is
        // gone.
        spawnSync(terminalTmuxBinary(), ['-S', socket, 'kill-session', '-t', info.id]);

        await expect(after.getState(info.id)).rejects.toThrow(/no longer running/);
    }, 30000);

    it('reports the shell as exited, without pretending to know its status', async () => {
        const manager = newManager();
        const info = await startShell(manager);

        await manager.write(info.id, 'exit 3\n');

        const deadline = Date.now() + 8000;
        let exited: TerminalInfo | undefined;
        while (Date.now() < deadline && !exited?.exited) {
            exited = (await manager.list()).find((entry) => entry.id === info.id);
            if (!exited?.exited) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        expect(exited?.exited).toBe(true);
        // What the PTY reports here is the attach client's status, not the
        // shell's, and tmux tears the session down before anything could read
        // the real one. Null is the honest answer; 0 would look like a fact.
        expect(exited?.exitCode).toBeNull();

        // And the shell really is gone, rather than detached.
        expect((await listTerminalSessions()).map((entry) => entry.id)).not.toContain(info.id);
    }, 30000);

    it('configures the server so a terminal behaves like a plain one', async () => {
        const manager = newManager();
        await startShell(manager);

        const options = spawnSync(terminalTmuxBinary(), ['-S', socket, 'show-options', '-g'], { encoding: 'utf8' }).stdout;

        // A status line would eat the bottom row of the screen the client draws.
        expect(options).toMatch(/^status off$/m);
        // C-b is a key a shell reads; left as the prefix, tmux would swallow it.
        expect(options).toMatch(/^prefix None$/m);
        expect(options).toMatch(/^prefix2 None$/m);
        // The whole point: an attach client leaving must not end the shell.
        expect(options).toMatch(/^destroy-unattached off$/m);
        // Without this the mirror sees no titles at all, and every tab falls
        // back to its directory name.
        expect(options).toMatch(/^set-titles on$/m);
    }, 30000);

    it('carries the shell title through to the terminal', async () => {
        const manager = newManager();
        const info = await startShell(manager);
        await manager.write(info.id, "printf '\\033]0;TITLE_MARKER\\007'\n");

        const deadline = Date.now() + 8000;
        let title: string | undefined;
        while (Date.now() < deadline && title !== 'TITLE_MARKER') {
            title = (await manager.list()).find((entry) => entry.id === info.id)?.title;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(title).toBe('TITLE_MARKER');
    }, 30000);

    it('does not label a terminal with the machine name tmux starts it with', async () => {
        const manager = newManager();
        const info = await startShell(manager);

        const recovered = (await listTerminalSessions()).find((entry) => entry.id === info.id);

        // tmux titles a new pane with the hostname and forwards it to the
        // client, so an unnamed terminal would carry the machine's name — which
        // the window already says elsewhere, and less use for telling tabs
        // apart than the directory it would otherwise fall back to.
        expect(recovered?.title).toBeUndefined();
    }, 30000);
});

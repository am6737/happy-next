import { afterEach, describe, expect, it } from 'vitest';
import { TerminalManager } from './terminalManager';
import type { TerminalOutputListener } from './terminalManager';
import type { TerminalState } from 'happy-wire';

/**
 * These run against a real pty in the real worker process — the point is to
 * exercise the daemon↔worker IPC and the screen mirror, not to mock them.
 */

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

function collectOutput(manager: TerminalManager, terminalId: string): {
    ready: Promise<void>;
    output: () => string;
    unsubscribe: () => void;
} {
    let buffer = '';
    let releaseReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        releaseReady = resolve;
    });

    const listener: TerminalOutputListener = {
        onOutput(data) {
            buffer += data;
        },
        onState() {
            releaseReady();
        },
        onExit() {},
        onTitle() {},
    };

    const subscription = manager.subscribe(terminalId, listener).then((unsubscribe) => {
        releaseReady();
        return unsubscribe;
    });

    return {
        ready: subscription.then(() => undefined),
        output: () => buffer,
        unsubscribe: () => {
            void subscription.then((unsubscribe) => unsubscribe());
        },
    };
}

describe('TerminalManager', () => {
    let manager: TerminalManager | null = null;

    afterEach(() => {
        manager?.stop();
        manager = null;
    });

    it('runs a command in a real pty and mirrors its screen', async () => {
        manager = new TerminalManager({ durable: false });
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });

        expect(info.id).toBeTruthy();
        expect(info.cwd).toBe(process.cwd());

        await waitForScreen(manager, info.id, (text) => text.length > 0);

        await manager.write(info.id, "printf 'MIRROR_MARKER\\n'\n");

        const screen = await waitForScreen(manager, info.id, (text) => text.includes('MIRROR_MARKER'));
        expect(screen).toContain('MIRROR_MARKER');
    }, 30000);

    it('resizes the pty and reports the new size', async () => {
        manager = new TerminalManager({ durable: false });
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });

        await manager.resize(info.id, { rows: 40, cols: 120 });

        const state = await manager.getState(info.id);
        expect(state.rows).toBe(40);
        expect(state.cols).toBe(120);
    }, 30000);

    it('captures styled cells from ANSI output', async () => {
        manager = new TerminalManager({ durable: false });
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });

        await waitForScreen(manager, info.id, (text) => text.length > 0);
        await manager.write(info.id, "printf '\\033[1;31mREDBOLD\\033[0m plain\\n'\n");
        await waitForScreen(manager, info.id, (text) => text.includes('REDBOLD'));

        const state = await manager.getState(info.id);

        // The command line is echoed literally (`printf '\033[1;31m...'`), so
        // match the *rendered* output instead: six BOLD-styled cells spelling
        // REDBOLD, which the literal echo can never produce.
        const runs: Array<{ text: string; cells: typeof state.grid[number] }> = [];
        for (const cells of state.grid) {
            let run: typeof state.grid[number] = [];
            const flushRun = () => {
                if (run.length > 0) {
                    runs.push({ text: run.map((cell) => cell.char).join(''), cells: run });
                    run = [];
                }
            };
            for (const cell of cells) {
                if (cell.bold) {
                    run.push(cell);
                } else {
                    flushRun();
                }
            }
            flushRun();
        }

        const styledRun = runs.find((entry) => entry.text.includes('REDBOLD'));
        expect(styledRun).toBeDefined();
        // Palette index 1 is red; the mirror must surface it, not flatten it.
        expect(styledRun!.cells[0]!.fg).toBe(1);
        expect(styledRun!.cells[0]!.char).toBe('R');
    }, 30000);

    it('delivers a state snapshot to a subscriber and then live output', async () => {
        manager = new TerminalManager({ durable: false });
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });

        await waitForScreen(manager, info.id, (text) => text.length > 0);

        const sink = collectOutput(manager, info.id);
        await sink.ready;

        await manager.write(info.id, "printf 'LIVE_OUTPUT\\n'\n");
        await waitForScreen(manager, info.id, (text) => text.includes('LIVE_OUTPUT'));

        // Subscribing after the shell started still yields the live bytes.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(sink.output()).toContain('LIVE_OUTPUT');
        sink.unsubscribe();
    }, 30000);

    it('reports exit when the shell terminates', async () => {
        manager = new TerminalManager({ durable: false });
        const info = await manager.create({
            cwd: process.cwd(),
            shell: '/bin/bash',
            args: ['--norc', '--noprofile'],
            size: { rows: 24, cols: 80 },
        });

        await waitForScreen(manager, info.id, (text) => text.length > 0);
        await manager.write(info.id, 'exit 0\n');

        const deadline = Date.now() + 8000;
        let exited = false;
        while (Date.now() < deadline && !exited) {
            const terminals = await manager.list();
            exited = terminals.find((entry) => entry.id === info.id)?.exited === true;
            if (!exited) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        expect(exited).toBe(true);
    }, 30000);

    it('surfaces terminals through list()', async () => {
        manager = new TerminalManager({ durable: false });
        const first = await manager.create({ cwd: process.cwd(), shell: '/bin/bash', args: ['--norc', '--noprofile'] });
        const second = await manager.create({ cwd: process.cwd(), shell: '/bin/bash', args: ['--norc', '--noprofile'] });

        const ids = (await manager.list()).map((entry) => entry.id);
        expect(ids).toContain(first.id);
        expect(ids).toContain(second.id);
    }, 30000);
});

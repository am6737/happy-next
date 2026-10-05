/**
 * Core terminal session: a PTY plus a headless xterm mirror of its screen.
 *
 * The mirror is what makes the mobile client viable — the app detaches
 * constantly (backgrounding, tab switches, network drops), and on reattach it
 * needs the current screen, not just the bytes since it left.
 *
 * The PTY may hold a shell directly or a tmux client attached to one. Nothing
 * below distinguishes them: the mirror is fed by this PTY either way, and tmux
 * repaints the whole screen when a client attaches, which is what makes a
 * mirror built from nothing correct again.
 */

import * as pty from 'node-pty';
import { existsSync } from 'node:fs';
import xterm, { type Terminal as HeadlessTerminalInstance } from '@xterm/headless';
import type { TerminalState } from 'happy-wire';
import {
    killTerminalSession,
    prepareTerminalTmuxServer,
    terminalTmuxAttachArgs,
    terminalTmuxBinary,
    terminalTmuxEnvironment,
} from './terminalTmux';

const { Terminal } = xterm;

export const DEFAULT_SCROLLBACK_LINES = 1000;

export interface TerminalExitInfo {
    exitCode: number | null;
    signal: number | null;
}

export interface TerminalSize {
    rows: number;
    cols: number;
}

export interface CreateTerminalOptions {
    id: string;
    cwd: string;
    shell?: string;
    args?: string[];
    env?: Record<string, string>;
    size?: TerminalSize;
    scrollbackLines?: number;
    /**
     * Put tmux between this PTY and the shell so it outlives this process. Only
     * set once the daemon has confirmed tmux is there; without it the shell
     * runs on the PTY directly, as it did before.
     */
    tmux?: boolean;
}

export type TerminalServerMessage =
    | { type: 'output'; data: string }
    | { type: 'state'; state: TerminalState }
    | { type: 'title'; title: string | undefined }
    | { type: 'exit'; exitCode: number | null; signal: number | null };

export type TerminalClientMessage =
    | { type: 'input'; data: string }
    | { type: 'resize'; rows: number; cols: number };

export interface TerminalSession {
    readonly id: string;
    readonly cwd: string;
    readonly shell: string;
    write(data: string): void;
    resize(size: TerminalSize): void;
    subscribe(listener: (message: TerminalServerMessage) => void): () => void;
    onExit(listener: (info: TerminalExitInfo) => void): () => void;
    getSize(): TerminalSize;
    getState(): TerminalState;
    getTitle(): string | undefined;
    getExitInfo(): TerminalExitInfo | null;
    kill(): Promise<void>;
    /**
     * Lets go of the PTY without ending the shell behind it. This is what the
     * worker does when its IPC channel closes and the daemon is about to be
     * replaced; a tmux-backed shell is meant to keep running through that.
     */
    detach(): void;
    dispose(): Promise<void>;
}

const DEFAULT_SIZE: TerminalSize = { rows: 30, cols: 100 };

export function resolveDefaultTerminalShell(platform = process.platform, currentShell = process.env.SHELL): string {
    if (platform === 'darwin') {
        return existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
    }
    if (currentShell) {
        return currentShell;
    }
    return '/bin/sh';
}

/**
 * Strips the OSC 0/1/2 window-title sequence out of a chunk so the title can be
 * surfaced without leaking the escape codes into the rendered grid. The bytes
 * are left intact — the mirror still needs to see them.
 */
function extractTitle(data: string): string | undefined {
    const match = /\][012];([^]*)(?:|\\)/.exec(data);
    if (!match || match[1] === undefined) {
        return undefined;
    }
    const title = match[1].trim();
    return title.length > 0 ? title : undefined;
}

export function createTerminalSession(options: CreateTerminalOptions): TerminalSession {
    const size = options.size ?? DEFAULT_SIZE;
    const scrollbackLines = options.scrollbackLines ?? DEFAULT_SCROLLBACK_LINES;
    const shell = options.shell ?? resolveDefaultTerminalShell();
    const shellArgs = options.args ?? [];
    const useTmux = options.tmux === true;

    const terminal = new Terminal({
        rows: size.rows,
        cols: size.cols,
        scrollback: scrollbackLines,
        allowProposedApi: true,
    });

    const terminalEnv = { ...process.env, ...options.env };
    const ptyOptions = {
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd: options.cwd,
        env: (useTmux ? terminalTmuxEnvironment(terminalEnv) : terminalEnv) as Record<string, string>,
    };

    // Under tmux the PTY runs an attach client, so the shell is started by tmux
    // and survives this process. Everything downstream sees the same bytes.
    if (useTmux) {
        prepareTerminalTmuxServer();
    }
    const ptyProcess = useTmux
        ? pty.spawn(
            terminalTmuxBinary(),
            terminalTmuxAttachArgs({
                id: options.id,
                cwd: options.cwd,
                shell,
                args: shellArgs,
                rows: size.rows,
                cols: size.cols,
            }),
            ptyOptions,
        )
        : pty.spawn(shell, shellArgs, ptyOptions);

    const listeners = new Set<(message: TerminalServerMessage) => void>();
    const exitListeners = new Set<(info: TerminalExitInfo) => void>();
    let exitInfo: TerminalExitInfo | null = null;
    let currentSize: TerminalSize = { rows: size.rows, cols: size.cols };
    let title: string | undefined;
    // Tracked separately: closing a terminal kills the process but keeps its
    // final screen readable, so "process gone" must not imply "mirror gone".
    let processExited = false;
    let disposed = false;

    function emit(message: TerminalServerMessage): void {
        for (const listener of listeners) {
            listener(message);
        }
    }

    function getState(): TerminalState {
        const buffer = terminal.buffer.active;
        const grid = [];
        const reusableCell = buffer.getNullCell();
        for (let row = 0; row < terminal.rows; row += 1) {
            const line = buffer.getLine(buffer.baseY + row);
            const cells = [];
            for (let col = 0; col < terminal.cols; col += 1) {
                const cell = line?.getCell(col, reusableCell);
                const fgMode = cell ? cell.getFgColorMode() >> 24 : 0;
                const bgMode = cell ? cell.getBgColorMode() >> 24 : 0;
                cells.push({
                    char: cell?.getChars() || ' ',
                    ...(cell ? { width: cell.getWidth() } : {}),
                    ...(fgMode !== 0 ? { fg: cell!.getFgColor(), fgMode } : {}),
                    ...(bgMode !== 0 ? { bg: cell!.getBgColor(), bgMode } : {}),
                    ...(cell?.isBold() ? { bold: true } : {}),
                    ...(cell?.isItalic() ? { italic: true } : {}),
                    ...(cell?.isUnderline() ? { underline: true } : {}),
                    ...(cell?.isDim() ? { dim: true } : {}),
                    ...(cell?.isInverse() ? { inverse: true } : {}),
                    ...(cell?.isStrikethrough() ? { strikethrough: true } : {}),
                });
            }
            grid.push(cells);
        }

        const core = (terminal as unknown as {
            _core?: { coreService?: { decPrivateModes?: { cursorStyle?: unknown; cursorBlink?: unknown }; isCursorHidden?: unknown } };
        })._core?.coreService;
        const cursorStyle = core?.decPrivateModes?.cursorStyle;
        const cursorBlink = core?.decPrivateModes?.cursorBlink;

        return {
            rows: terminal.rows,
            cols: terminal.cols,
            grid,
            cursor: {
                row: buffer.cursorY,
                col: buffer.cursorX,
                ...(core?.isCursorHidden ? { hidden: true } : {}),
                ...(cursorStyle === 'block' || cursorStyle === 'underline' || cursorStyle === 'bar'
                    ? { style: cursorStyle }
                    : {}),
                ...(typeof cursorBlink === 'boolean' ? { blink: cursorBlink } : {}),
            },
        };
    }

    ptyProcess.onData((data) => {
        if (processExited) {
            return;
        }

        const nextTitle = extractTitle(data);
        if (nextTitle !== undefined && nextTitle !== title) {
            title = nextTitle;
            emit({ type: 'title', title });
        }

        terminal.write(data, () => {
            if (!disposed) {
                emit({ type: 'output', data });
            }
        });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
        if (processExited) {
            return;
        }
        processExited = true;
        // Under tmux this PTY held the attach client rather than the shell, so
        // the status is the client's and says nothing about what ran inside.
        // Reporting it would be a specific-looking lie, and there is no way to
        // get the shell's own status out of a session tmux has already torn
        // down — so the code is reported as unknown.
        exitInfo = useTmux ? { exitCode: null, signal: null } : { exitCode, signal: signal ?? null };
        emit({
            type: 'exit',
            exitCode: exitInfo.exitCode,
            signal: exitInfo.signal,
        });
        for (const listener of exitListeners) {
            listener(exitInfo);
        }
    });

    /**
     * Ends the process and reports the exit exactly once.
     *
     * The exit is reported from here rather than left to the pty's own onExit,
     * which no longer fires once the process is flagged as exited — otherwise a
     * closed terminal would stay marked as running forever.
     */
    async function killProcess(): Promise<void> {
        if (processExited) {
            return;
        }
        processExited = true;
        try {
            ptyProcess.kill();
        } catch {
            // The process may already be gone; killing a dead pty is not an error.
        }
        // The PTY only holds an attach client, so killing it detaches from the
        // shell rather than ending it. Closing a terminal has to mean the shell
        // dies, or it would keep running unseen with nothing able to reach it.
        if (useTmux) {
            await killTerminalSession(options.id);
        }
        exitInfo = { exitCode: null, signal: null };
        emit({ type: 'exit', exitCode: null, signal: null });
        for (const listener of exitListeners) {
            listener(exitInfo);
        }
    }

    return {
        id: options.id,
        cwd: options.cwd,
        shell,

        write(data) {
            if (processExited) {
                return;
            }
            ptyProcess.write(data);
        },

        resize(next) {
            if (processExited) {
                return;
            }
            if (next.rows === currentSize.rows && next.cols === currentSize.cols) {
                return;
            }
            currentSize = { rows: next.rows, cols: next.cols };
            ptyProcess.resize(next.cols, next.rows);
            terminal.resize(next.cols, next.rows);
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        onExit(listener) {
            exitListeners.add(listener);
            return () => exitListeners.delete(listener);
        },

        getSize() {
            return { ...currentSize };
        },

        getState,

        getTitle() {
            return title;
        },

        getExitInfo() {
            return exitInfo;
        },

        kill() {
            return killProcess();
        },

        detach() {
            disposed = true;
            try {
                ptyProcess.kill();
            } catch {
                // Already gone, which is the outcome this wanted anyway.
            }
        },

        async dispose() {
            await killProcess();
            disposed = true;
            terminal.dispose();
            listeners.clear();
            exitListeners.clear();
        },
    };
}

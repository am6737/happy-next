/**
 * tmux as the durable layer under a terminal.
 *
 * A PTY dies with the process holding it, so without this every daemon
 * restart — an upgrade, a crash — would take every shell with it. tmux does
 * not: it owns the shell in a server of its own and the daemon holds nothing
 * but an attach client. When that client goes away the shell keeps running,
 * and the next attach puts the same screen back.
 *
 * The server listens on a private socket under the happy home directory, so
 * none of this reaches a tmux the user runs themselves and these shells never
 * turn up in their `tmux ls`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

const SOCKET_FILE = 'terminals.sock';
const CONFIG_FILE = 'terminals.tmux.conf';

/**
 * Where tmux is looked for before PATH gets a say.
 *
 * A bare `spawn('tmux')` resolves through the daemon's own PATH, and a daemon
 * started by launchd — which is what `happy daemon install` sets up — has the
 * barest one, /usr/bin:/bin:/usr/sbin:/sbin. That is not where Homebrew or
 * MacPorts put anything, so the same machine would get durable terminals when
 * the daemon was started from a shell and none when it was started at login,
 * with nothing to say why. PATH is still consulted last, so an install in a
 * place this list does not know about keeps working.
 */
const TMUX_SEARCH_PATHS = [
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/opt/local/bin/tmux',
    '/usr/bin/tmux',
];

let resolvedBinary: string | null = null;

export function terminalTmuxBinary(): string {
    // Only a hit is worth keeping. A miss is looked for again, because tmux may
    // be installed while the daemon runs and this is four `existsSync` calls
    // against telling the user to restart it.
    resolvedBinary ??= TMUX_SEARCH_PATHS.find((candidate) => existsSync(candidate)) ?? null;
    return resolvedBinary ?? 'tmux';
}

/**
 * The pane's title, or nothing while it still holds tmux's placeholder.
 *
 * tmux gives every new pane the hostname as its title and forwards that to the
 * client, so a terminal nobody has named yet would label its tab with the
 * machine's name — the one thing the window already says elsewhere, and less
 * use than the directory the tab would fall back to. A title equal to the host
 * is that placeholder rather than something the shell chose.
 *
 * Used both as the client title format and as the `list-panes` field read back
 * after a restart, so a recovered terminal is labelled exactly like a live one.
 */
const PANE_TITLE_FORMAT = '#{?#{==:#{pane_title},#{host}},,#{pane_title}}';

const CONFIG_COMMAND = [
    // The app draws its own tabs; a tmux status line would only eat the bottom
    // row of the screen the client renders.
    'set -g status off',
    // The point of all this: an attach client leaving must not end the shell.
    'set -g destroy-unattached off',
    // C-b is a key a shell reads — backward-char in emacs mode, and one of the
    // chords the app's key bar can send. As the prefix, tmux would swallow it.
    'set -g prefix None',
    'set -g prefix2 None',
    // What the shell inside believes it is talking to. Everything has a terminfo
    // entry for screen; the mirror only ever sees the attach client's
    // xterm-256color.
    'set -g default-terminal screen-256color',
    // Forwards the pane's title out to the attach client as an OSC title
    // sequence, which is how the mirror learns a terminal's title now that tmux
    // sits in between and the shell's own escape never reaches it.
    'set -g set-titles on',
    `set -g set-titles-string '${PANE_TITLE_FORMAT}'`,
    // The default half second spent deciding whether ESC begins a sequence is
    // felt in vim.
    'set -g escape-time 10',
    // Bounded to match the mirror's scrollback. Nothing reads further back, and
    // tmux keeps this per pane in memory.
    'set -g history-limit 1000',
];

/**
 * Writes the configuration the server will read when it starts.
 *
 * Called on the way to every tmux client, not just the availability probe: a
 * client that starts the server with a `-f` pointing at nothing gets an error
 * painted into the terminal and every option below skipped, which is silent
 * breakage in exactly the places this configuration exists to protect.
 *
 * tmux reads its configuration only at server start, and the server outlives
 * any daemon — so a change here lands on the next server, not the running one.
 * Killing the server (`tmux -S <socket> kill-server`) applies it sooner; the
 * shells go with it.
 */
export function prepareTerminalTmuxServer(): void {
    mkdirSync(dirname(terminalTmuxSocketPath()), { recursive: true });
    writeFileSync(configPath(), `${CONFIG_COMMAND.join('\n')}\n`, { mode: 0o600 });
}

export function terminalTmuxSocketPath(): string {
    // Read per call rather than once: two daemons sharing a home directory may
    // still want their own servers, and a test that starts one must not adopt
    // the shells of the daemon already running on the machine.
    return process.env.HAPPY_TERMINAL_TMUX_SOCKET || join(configuration.happyHomeDir, SOCKET_FILE);
}

/** Kept beside the socket, so a server and its configuration travel together. */
function configPath(): string {
    return join(dirname(terminalTmuxSocketPath()), CONFIG_FILE);
}

const UTF8_LOCALE = /UTF-?8/i;

/**
 * The environment a tmux client runs with.
 *
 * tmux drops to a non-UTF-8 mode — mangling the CJK this app renders — when no
 * locale says otherwise, and a daemon started by launchd or a service manager
 * has no LANG at all. That is the ordinary case here, so one is supplied.
 */
export function terminalTmuxEnvironment(
    env: Record<string, string | undefined>,
): Record<string, string | undefined> {
    const declaresUtf8 = [env.LC_ALL, env.LC_CTYPE, env.LANG].some(
        (value) => Boolean(value) && UTF8_LOCALE.test(value as string),
    );
    if (declaresUtf8) {
        return env;
    }
    return { ...env, LC_CTYPE: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' };
}

interface TmuxResult {
    code: number;
    stdout: string;
    stderr: string;
}

/**
 * Reported when tmux had to be killed rather than exiting on its own.
 *
 * Distinct from any code tmux returns, so a caller can tell "tmux answered"
 * from "tmux never answered". Without it a wedged tmux would look like a
 * success — and for `has-session` that means attaching where there is nothing,
 * which `new-session -A` turns into a fresh shell in place of the one expected.
 */
const TMUX_KILLED = -1;

function tmuxArgs(args: readonly string[]): string[] {
    return ['-S', terminalTmuxSocketPath(), '-f', configPath(), ...args];
}

/**
 * Runs a tmux command against our server.
 *
 * Rejects only when tmux cannot be run at all; a tmux that ran and refused is a
 * result, because "no server running" is a normal answer rather than a fault.
 */
function run(args: readonly string[], timeoutMs = 5_000): Promise<TmuxResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(terminalTmuxBinary(), tmuxArgs(args), {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: terminalTmuxEnvironment(process.env),
            timeout: timeoutMs,
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            resolve({ code: signal ? TMUX_KILLED : code ?? 0, stdout, stderr });
        });
    });
}

let availability: Promise<boolean> | null = null;

/**
 * Whether terminals can be made durable on this machine.
 *
 * A yes is kept and a no is not. tmux does not disappear in a way anything here
 * could act on, so asking twice is waste — but it does get installed, and a
 * daemon that had already decided otherwise would go on ignoring it until the
 * next restart. Re-probing costs one short-lived process on the next terminal
 * instead, which is the better trade.
 */
export function isTerminalTmuxAvailable(): Promise<boolean> {
    availability ??= probe().then((found) => {
        if (!found) {
            availability = null;
        }
        return found;
    });
    return availability;
}

async function probe(): Promise<boolean> {
    try {
        prepareTerminalTmuxServer();
        const result = await run(['list-sessions']);
        // A tmux that answered is available even when the answer is "no server
        // running". One that had to be killed is not: it would hang, or be
        // killed, on every command that followed.
        return result.code !== TMUX_KILLED;
    } catch (error) {
        logger.debug('[terminal-tmux] tmux is unavailable; terminals will not survive a restart', error);
        return false;
    }
}

/**
 * Terminal ids double as tmux session names, so they have to stay inside what
 * tmux accepts and away from the characters it reads as target syntax.
 */
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isTerminalId(value: string): boolean {
    return TERMINAL_ID_PATTERN.test(value);
}

export interface TmuxTerminal {
    id: string;
    cwd: string;
    rows: number;
    cols: number;
    title?: string;
}

/**
 * The separator between a terminal's id and the value asked for beside it.
 *
 * Printable, because tmux rewrites the bytes it considers unprintable — to `_`
 * through 3.2, to a literal `\037` from 3.4 — and it rewrites the whole line,
 * literals included. Which byte it rewrites, and to what, changes between
 * versions, so no control byte can be asked for and read back.
 *
 * A printable one is only safe because of where it sits. A terminal id is
 * constrained to `[A-Za-z0-9._-]` (see `isTerminalId`), so it cannot contain
 * this, and everything past the first occurrence is taken verbatim: a directory
 * or a title is free to hold it.
 */
const FIELD_SEPARATOR = '|';

/**
 * One field, for every terminal tmux is holding, keyed by terminal id.
 *
 * Asked for one field per call rather than all of them together, because only
 * the id in front of the separator has a charset this can rule on. With two
 * free-form fields on one line a `|` in a directory and a `|` in a title are
 * the same character, and no split tells them apart.
 */
async function readField(format: string): Promise<Map<string, string>> {
    const result = await run(['list-panes', '-a', '-F', `#{session_name}${FIELD_SEPARATOR}${format}`]);
    if (result.code !== 0) {
        // No server running is the ordinary state before the first terminal.
        return new Map();
    }

    const values = new Map<string, string>();
    for (const line of result.stdout.split('\n')) {
        const boundary = line.indexOf(FIELD_SEPARATOR);
        const id = boundary > 0 ? line.slice(0, boundary) : '';
        // An id is never empty and never holds the separator, so a line that
        // starts with one — or has none at all — is not a pane this understands.
        if (!isTerminalId(id)) {
            continue;
        }
        values.set(id, line.slice(boundary + FIELD_SEPARATOR.length));
    }
    return values;
}

/**
 * The terminals tmux is holding right now.
 *
 * Read from tmux rather than remembered, because tmux is the only account that
 * survives the daemon being replaced.
 */
export async function listTerminalSessions(): Promise<TmuxTerminal[]> {
    const [paths, heights, widths, titles] = await Promise.all([
        readField('#{pane_current_path}'),
        readField('#{pane_height}'),
        readField('#{pane_width}'),
        readField(PANE_TITLE_FORMAT),
    ]);

    const terminals: TmuxTerminal[] = [];
    for (const [id, height] of heights) {
        const width = widths.get(id);
        // A pane listed without its size is one that went away between the
        // reads. The next listing is a better answer than a terminal guessed at.
        if (width === undefined) {
            continue;
        }
        const rows = Number(height);
        const cols = Number(width);
        if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
            continue;
        }
        // A shell that has been removed out from under still reports its last
        // directory, which is a better answer for a label than nothing.
        const title = titles.get(id);
        terminals.push({ id, cwd: paths.get(id) || '/', rows, cols, title: title || undefined });
    }
    return terminals;
}

export interface TerminalTmuxAttachOptions {
    id: string;
    cwd: string;
    shell: string;
    args: readonly string[];
    rows: number;
    cols: number;
}

/**
 * The argv for a PTY that attaches to a terminal.
 *
 * `new-session -A` is what lets one path serve both cases: an id nobody has
 * used before starts a shell in `cwd`, and an id left over from before a
 * restart attaches to the shell still running under it. Size, directory and
 * command are all ignored when the session already exists, so passing them
 * again is harmless.
 */
export function terminalTmuxAttachArgs(options: TerminalTmuxAttachOptions): string[] {
    return tmuxArgs([
        'new-session', '-A',
        '-s', options.id,
        '-x', String(options.cols),
        '-y', String(options.rows),
        '-c', options.cwd,
        options.shell,
        ...options.args,
    ]);
}

export async function hasTerminalSession(id: string): Promise<boolean> {
    const result = await run(['has-session', '-t', id]);
    return result.code === 0;
}

/**
 * Ends the shell behind a terminal.
 *
 * Killing the attach client only detaches, so a terminal that is being closed
 * has to be ended here as well or it would keep running with nothing attached
 * to it and no way back to it from the app.
 */
export async function killTerminalSession(id: string): Promise<void> {
    try {
        await run(['kill-session', '-t', id]);
    } catch (error) {
        logger.debug(`[terminal-tmux] could not end session ${id}`, error);
    }
}

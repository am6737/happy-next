import type { TerminalInfo, TerminalSpawnRequest } from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import type { TerminalTab } from './terminalTabs';

/** A first paint is not worth a second round trip, so the real size is claimed
 *  by the screen as soon as it has measured itself. */
const PLACEHOLDER_ROWS = 24;
const PLACEHOLDER_COLS = 80;

/**
 * The directory a terminal should open in, taken from the thing that was
 * opened from. A session knows the checkout it runs in; anything else falls
 * back to the machine's home directory.
 */
export function resolveTerminalDirectory(input: { sessionPath?: string; homeDir?: string }): string {
    return input.sessionPath ?? input.homeDir ?? '/';
}

/**
 * Starts a shell and hands it back.
 *
 * Deliberately not `resolveTerminalForDirectory`: both callers mean "start
 * another one". The + button offers to place a new terminal, and duplicating a
 * tab asks for a second shell in the directory the first one is in — being sent
 * to the shell that is already there would make either of them look like it did
 * nothing.
 */
export async function spawnTerminal(input: { machineId: string; cwd: string }): Promise<TerminalInfo> {
    return await apiSocket.machineRPC<TerminalInfo, TerminalSpawnRequest>(
        input.machineId,
        'terminal-spawn',
        { cwd: input.cwd, rows: PLACEHOLDER_ROWS, cols: PLACEHOLDER_COLS },
    );
}

/**
 * A daemon's terminal, with a usable directory on it.
 *
 * A daemon is a separate program and can be older than this app, and one is: the
 * version that recorded a terminal started without a directory as having no
 * `cwd` at all. Everything downstream labels a tab and captions the screen from
 * that field, so a single terminal without it took the whole terminal page down
 * — and the record outlives the app, so it kept doing it until the daemon was
 * restarted or the terminal was closed.
 *
 * Empty is the honest stand-in, since there is no directory to name. The label
 * falls back to the terminal's id, which is what it already does for a shell at
 * the filesystem root, where there is equally nothing to show.
 */
export function normalizeTerminal(terminal: TerminalInfo): TerminalInfo {
    return typeof terminal.cwd === 'string' && terminal.cwd.length > 0
        ? terminal
        : { ...terminal, cwd: '' };
}

/**
 * Every shell running on a machine.
 *
 * The daemon is the authority on what is still running, so this is asked rather
 * than remembered — a terminal outlives the app, and two devices looking at one
 * machine have to see the same set.
 *
 * The timeout is well under the default: a list is a first paint, and a machine
 * that is slow to answer should cost its own tabs rather than the whole strip.
 */
export async function listMachineTerminals(machineId: string, timeout = 10000): Promise<TerminalTab[]> {
    const terminals = await apiSocket.machineRPC<TerminalInfo[], Record<string, never>>(
        machineId,
        'terminal-list',
        {},
        timeout,
    );
    return terminals.map((terminal) => ({ machineId, terminal: normalizeTerminal(terminal) }));
}

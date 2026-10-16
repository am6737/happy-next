/**
 * Terminal session wire contract, shared by the daemon that owns the PTY and
 * the client that renders it.
 *
 * Plain types rather than Zod schemas: none of this is user-supplied input. The
 * daemon produces it, the client consumes it, and the relay in between only
 * ever sees it encrypted — so there is no untrusted boundary here to validate
 * at. The grid in particular is large enough that parsing it per frame would
 * cost more than the rendering.
 */

/** A single character cell with its resolved attributes. */
export interface TerminalCell {
    /** The character(s) in this cell. Empty cells are a single space. */
    char: string;
    /**
     * Columns this cell occupies — 2 for CJK/emoji. Included so the client can
     * advance its layout correctly instead of measuring glyph width at runtime.
     */
    width?: number;
    /** Palette index or packed RGB; interpret alongside `fgMode`. */
    fg?: number;
    bg?: number;
    /**
     * How to read the matching colour value, taken from xterm's `ColorMode`:
     * 1 = ANSI palette (0-15), 2 = indexed palette (0-255), 3 = packed RGB.
     * Absent or 0 means "default", in which case the value is meaningless.
     */
    fgMode?: number;
    bgMode?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
    inverse?: boolean;
    strikethrough?: boolean;
}

export interface TerminalCursor {
    row: number;
    col: number;
    hidden?: boolean;
    style?: 'block' | 'underline' | 'bar';
    blink?: boolean;
}

/** The visible viewport plus cursor. Scrollback is not included. */
export interface TerminalState {
    rows: number;
    cols: number;
    grid: TerminalCell[][];
    cursor: TerminalCursor;
}

export interface TerminalInfo {
    id: string;
    cwd: string;
    title?: string;
    size: { rows: number; cols: number };
    /** True once the underlying process has exited; the session may still be read. */
    exited: boolean;
    exitCode?: number | null;
}

/**
 * What the client receives on the stream, once decrypted.
 *
 * A `snapshot` is pushed through the same stream as the deltas that follow it,
 * so socket ordering — not a revision comparison — is what makes the screen
 * correct. `revision` is only a gap detector for lossy links.
 *
 * The snapshot carries **ANSI, not a grid**. A client that renders the screen
 * itself maintains an emulator, and no emulator exposes "set the grid": the
 * only way to seed one is to feed it terminal output. So the daemon renders its
 * mirror back down to escape sequences and the client replays them. `rows` and
 * `cols` are the dimensions that rendering assumed, so the client can size its
 * own mirror to match before replaying.
 */
export type TerminalFrameBody =
    | { type: 'snapshot'; ansi: string; rows: number; cols: number }
    | { type: 'output'; data: string }
    | { type: 'title'; title: string | undefined }
    | { type: 'exit'; exitCode: number | null; signal: number | null };

/**
 * One frame as it travels the relay.
 *
 * `payload` is the encrypted `TerminalFrameBody`; `revision` rides outside the
 * ciphertext so the server can order frames without reading them.
 *
 * Deliberately carries no machine id. The daemon's connection already says
 * which machine it is, and taking the id from there rather than from the frame
 * is what stops a client from injecting output into another machine's stream.
 */
export interface TerminalFrame {
    terminalId: string;
    revision: number;
    payload: string;
}

/** A frame after the relay has stamped it with the sending machine. */
export interface TerminalRelayedFrame extends TerminalFrame {
    machineId: string;
}

export interface TerminalSpawnRequest {
    id?: string;
    /**
     * Where to start the shell. Optional because the client is not the side
     * that knows the machine's filesystem — the daemon falls back to the
     * account's home directory, which is what a terminal should open in when
     * nobody has said otherwise.
     */
    cwd?: string;
    shell?: string;
    args?: string[];
    env?: Record<string, string>;
    rows?: number;
    cols?: number;
}

export interface TerminalRefRequest {
    terminalId: string;
}

export interface TerminalInputRequest extends TerminalRefRequest {
    data: string;
}

export interface TerminalResizeRequest extends TerminalRefRequest {
    rows: number;
    cols: number;
}

/** The revision the attach snapshot was sent at. */
export interface TerminalAttachResponse {
    revision: number;
}

export interface TerminalOkResponse {
    ok: true;
}

/**
 * The terminal methods a desktop client on the daemon's own computer may call
 * over the loopback socket rather than through the server. Nothing else is
 * reachable there: the socket exists to take the server out of a terminal's
 * keystroke round trip, not to be a second door into the daemon.
 */
export const LOCAL_TERMINAL_METHODS = [
    'terminal-spawn',
    'terminal-attach',
    'terminal-input',
    'terminal-resize',
    'terminal-close',
    'terminal-dispose',
    'terminal-list',
    'terminal-state',
] as const;

export type LocalTerminalMethod = (typeof LOCAL_TERMINAL_METHODS)[number];

/**
 * What a client sends on the loopback terminal socket.
 *
 * `params` is encrypted with the machine key exactly as on the server's RPC
 * path, so the daemon runs it through the same handler and answers in kind.
 */
export type LocalTerminalClientMessage =
    | { type: 'rpc'; id: number; method: LocalTerminalMethod; params: string }
    | { type: 'subscribe'; terminalId: string }
    | { type: 'unsubscribe'; terminalId: string };

/**
 * What the daemon sends back. `result` is the encrypted answer the server path
 * would have relayed; `error` is the socket refusing the call before any
 * handler saw it. Frames are the very ones the server relays, revisions
 * included, so a client can switch between the two paths mid-stream.
 */
export type LocalTerminalServerMessage =
    | { type: 'rpc-result'; id: number; result: string }
    | { type: 'rpc-result'; id: number; error: string }
    | { type: 'frame'; frame: TerminalFrame };

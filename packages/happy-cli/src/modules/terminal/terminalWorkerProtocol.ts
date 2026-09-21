/**
 * IPC contract between the daemon and its terminal worker process.
 *
 * The worker exists for crash isolation: node-pty's Windows conpty backend can
 * throw from a thread where no `try` can reach it, and on any platform a bad
 * spawn (missing cwd, missing shell) fails asynchronously. Hosting PTYs in the
 * daemon itself would let one bad terminal take down every session it manages.
 */

import type { TerminalState } from 'happy-wire';

export interface WorkerTerminalSize {
    rows: number;
    cols: number;
}

export interface WorkerCreateOptions {
    id: string;
    /** Resolved by the manager before it gets here; the worker always has one. */
    cwd: string;
    shell?: string;
    args?: string[];
    env?: Record<string, string>;
    size?: WorkerTerminalSize;
    scrollbackLines?: number;
    /**
     * Run the shell under tmux so it outlives this worker. Only set when the
     * manager has confirmed tmux is available.
     */
    tmux?: boolean;
    /**
     * Attach to a tmux session that is already running under this id rather
     * than starting one. Used to take back a shell that survived a restart, and
     * deliberately strict: if the session is gone the request fails instead of
     * quietly handing back a new shell in its place.
     */
    reattach?: boolean;
}

export type TerminalWorkerRequest =
    | { type: 'create'; requestId: string; options: WorkerCreateOptions }
    | { type: 'write'; requestId: string; terminalId: string; data: string }
    | { type: 'resize'; requestId: string; terminalId: string; size: WorkerTerminalSize }
    | { type: 'getState'; requestId: string; terminalId: string }
    | { type: 'kill'; requestId: string; terminalId: string }
    | { type: 'dispose'; requestId: string; terminalId: string };

/**
 * A request before the caller assigns its id.
 *
 * `Omit` over a union collapses it to the members' common keys, which loses the
 * discriminant — distributing over the union preserves each variant's shape.
 */
export type TerminalWorkerRequestInput = TerminalWorkerRequest extends infer Request
    ? Request extends TerminalWorkerRequest
        ? Omit<Request, 'requestId'>
        : never
    : never;

export type TerminalWorkerResponse =
    | { type: 'ok'; requestId: string; result?: unknown }
    | { type: 'error'; requestId: string; error: string };

export type TerminalWorkerEvent =
    | { type: 'output'; terminalId: string; data: string }
    | { type: 'title'; terminalId: string; title: string | undefined }
    | { type: 'exit'; terminalId: string; exitCode: number | null; signal: number | null };

/** Everything the worker may send to the daemon. */
export type TerminalWorkerMessage = TerminalWorkerResponse | TerminalWorkerEvent;

/** State payload returned by `getState`, used to (re)attach a client. */
export interface TerminalStateResult {
    state: TerminalState;
}

export function isWorkerResponse(message: TerminalWorkerMessage): message is TerminalWorkerResponse {
    return message.type === 'ok' || message.type === 'error';
}

export function isWorkerEvent(message: TerminalWorkerMessage): message is TerminalWorkerEvent {
    return message.type === 'output' || message.type === 'title' || message.type === 'exit';
}

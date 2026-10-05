/**
 * Terminal worker: owns every PTY, one process away from the daemon.
 *
 * Run via `child_process.fork`, so a node-pty failure kills only this process.
 * The daemon notices the disconnect and takes the terminals back — from tmux
 * where it is available, and as lost where it is not.
 */

import { createTerminalSession, type TerminalSession } from './terminalSession';
import { hasTerminalSession, isTerminalId } from './terminalTmux';
import type {
    TerminalWorkerMessage,
    TerminalWorkerRequest,
    WorkerCreateOptions,
} from './terminalWorkerProtocol';

const sessions = new Map<string, TerminalSession>();
let ipcClosing = false;

function send(message: TerminalWorkerMessage): void {
    if (ipcClosing || !process.connected || !process.send) {
        return;
    }
    try {
        process.send(message, (error) => {
            if (error) {
                ipcClosing = true;
            }
        });
    } catch {
        ipcClosing = true;
    }
}

/**
 * node-pty reports some spawn failures from an un-catchable context. Without
 * this the whole worker — and every terminal in it — would die and take the
 * failure reason with it, so log it and stay up for the remaining terminals.
 */
process.on('uncaughtException', (error) => {
    console.error('[terminal-worker] uncaught exception (kept alive):', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[terminal-worker] unhandled rejection (kept alive):', reason);
});

async function createTerminal(requestId: string, options: WorkerCreateOptions): Promise<void> {
    if (sessions.has(options.id)) {
        send({ type: 'error', requestId, error: `Terminal ${options.id} already exists` });
        return;
    }

    // A terminal id becomes a tmux session name, so it has to be one tmux will
    // take. Refusing here keeps the failure legible instead of surfacing it as
    // a PTY that died at startup with output nobody can read.
    if (options.tmux && !isTerminalId(options.id)) {
        send({ type: 'error', requestId, error: `Terminal id ${options.id} cannot be used as a tmux session name` });
        return;
    }

    if (options.reattach && !(await hasTerminalSession(options.id))) {
        send({ type: 'error', requestId, error: `Terminal ${options.id} is no longer running` });
        return;
    }

    const session = createTerminalSession(options);
    sessions.set(options.id, session);

    session.subscribe((message) => {
        if (message.type === 'output') {
            send({ type: 'output', terminalId: options.id, data: message.data });
            return;
        }
        if (message.type === 'title') {
            send({ type: 'title', terminalId: options.id, title: message.title });
        }
    });

    session.onExit((info) => {
        send({
            type: 'exit',
            terminalId: options.id,
            exitCode: info.exitCode,
            signal: info.signal,
        });
    });

    send({ type: 'ok', requestId });
}

async function handleRequest(request: TerminalWorkerRequest): Promise<void> {
    const { requestId } = request;

    if (request.type === 'create') {
        await createTerminal(requestId, request.options);
        return;
    }

    const session = sessions.get(request.terminalId);
    if (!session) {
        send({ type: 'error', requestId, error: `Unknown terminal ${request.terminalId}` });
        return;
    }

    if (request.type === 'write') {
        session.write(request.data);
        send({ type: 'ok', requestId });
        return;
    }

    if (request.type === 'resize') {
        session.resize(request.size);
        send({ type: 'ok', requestId });
        return;
    }

    if (request.type === 'getState') {
        send({ type: 'ok', requestId, result: session.getState() });
        return;
    }

    if (request.type === 'dispose') {
        sessions.delete(request.terminalId);
        await session.dispose();
        send({ type: 'ok', requestId });
        return;
    }

    // 'kill' — keep the session so its final screen and exit code stay readable.
    await session.kill();
    send({ type: 'ok', requestId });
}

process.on('message', (message: TerminalWorkerRequest) => {
    handleRequest(message).catch((error) => {
        send({
            type: 'error',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    });
});

process.on('disconnect', () => {
    ipcClosing = true;
    // Detach rather than kill: the daemon is being replaced, and a shell under
    // tmux is supposed to live through that. Ending it here would throw away
    // exactly what the tmux layer was added to keep.
    for (const session of sessions.values()) {
        session.detach();
    }
    sessions.clear();
    process.exit(0);
});

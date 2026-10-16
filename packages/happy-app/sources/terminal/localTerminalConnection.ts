import { invoke } from '@tauri-apps/api/core';
import type {
    LocalTerminalClientMessage,
    LocalTerminalMethod,
    LocalTerminalServerMessage,
    TerminalFrame,
} from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import { getLocalMachineIds, loadLocalMachineIds } from '@/desktop/desktopLocalMachine';
import { isTauriDesktop } from '@/utils/tauri';

/** Loopback either answers at once or is not there; anything slower is not worth waiting for. */
const CONNECT_TIMEOUT_MS = 2000;
/** How long a machine whose daemon could not be reached is left on the server path before trying again. */
const RETRY_AFTER_MS = 5000;
const DEFAULT_RPC_TIMEOUT_MS = 30000;

/**
 * The call never left: the loopback socket was already gone. Unlike a call
 * that was cut off on its way, this one is safe to send through the server.
 */
export class LocalTerminalUnavailableError extends Error {
    constructor() {
        super('Local terminal connection is closed');
    }
}

interface LocalTerminalEndpoint {
    port: number;
    token: string;
}

interface PendingCall {
    resolve: (result: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * The desktop app's own line to the daemon on this computer, for its terminals.
 *
 * Carries the same encrypted calls and the same frames as the server, so
 * whatever reads them does not care which path they came by. One per machine,
 * shared by every terminal on it; once closed it stays closed and the next
 * request opens a new one, since a daemon that went away comes back on a
 * different port with a different token.
 */
export class LocalTerminalConnection {
    private nextId = 1;
    private readonly pending = new Map<number, PendingCall>();
    private readonly frameHandlers = new Map<string, Set<(frame: TerminalFrame) => void>>();
    private readonly closeListeners = new Set<() => void>();
    private closed = false;

    constructor(
        private readonly machineId: string,
        private readonly socket: WebSocket,
    ) {
        socket.onmessage = (event) => {
            let message: LocalTerminalServerMessage;
            try {
                message = JSON.parse(String(event.data)) as LocalTerminalServerMessage;
            } catch {
                return;
            }
            this.handleMessage(message);
        };
        socket.onclose = () => this.handleClose();
        socket.onerror = () => socket.close();
    }

    get isClosed(): boolean {
        return this.closed;
    }

    async rpc<R, A>(method: LocalTerminalMethod, params: A, timeout = DEFAULT_RPC_TIMEOUT_MS): Promise<R> {
        const encrypted = await apiSocket.encryptMachinePayload(this.machineId, params);
        if (this.closed) {
            throw new LocalTerminalUnavailableError();
        }
        const id = this.nextId++;
        const result = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Local terminal call timed out'));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.send({ type: 'rpc', id, method, params: encrypted });
        });
        return await apiSocket.decryptMachineRpcResult<R>(this.machineId, result);
    }

    /** Frames of one terminal; the daemon is told only about the first watcher and the last to leave. */
    subscribe(terminalId: string, handler: (frame: TerminalFrame) => void): () => void {
        const handlers = this.frameHandlers.get(terminalId) ?? new Set();
        if (handlers.size === 0) {
            this.send({ type: 'subscribe', terminalId });
        }
        handlers.add(handler);
        this.frameHandlers.set(terminalId, handlers);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0 && this.frameHandlers.get(terminalId) === handlers) {
                this.frameHandlers.delete(terminalId);
                this.send({ type: 'unsubscribe', terminalId });
            }
        };
    }

    onClose(listener: () => void): () => void {
        this.closeListeners.add(listener);
        return () => {
            this.closeListeners.delete(listener);
        };
    }

    private send(message: LocalTerminalClientMessage): void {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    private handleMessage(message: LocalTerminalServerMessage): void {
        if (message.type === 'frame') {
            for (const handler of [...(this.frameHandlers.get(message.frame.terminalId) ?? [])]) {
                handler(message.frame);
            }
            return;
        }
        const call = this.pending.get(message.id);
        if (!call) {
            return;
        }
        this.pending.delete(message.id);
        clearTimeout(call.timer);
        if ('error' in message) {
            call.reject(new Error(message.error));
            return;
        }
        call.resolve(message.result);
    }

    private handleClose(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        // Sent, and maybe run: the daemon may have acted on these before it went
        // away, so they fail rather than being sent a second time elsewhere.
        for (const call of this.pending.values()) {
            clearTimeout(call.timer);
            call.reject(new Error('Local terminal connection closed'));
        }
        this.pending.clear();
        for (const listener of [...this.closeListeners]) {
            listener();
        }
    }
}

async function openConnection(machineId: string): Promise<LocalTerminalConnection | null> {
    await loadLocalMachineIds();
    if (!getLocalMachineIds().has(machineId)) {
        return null;
    }
    const endpoint = await invoke<LocalTerminalEndpoint | null>('get_local_terminal_endpoint', { machineId })
        .catch(() => null);
    if (!endpoint) {
        return null;
    }
    const socket = new WebSocket(
        `ws://127.0.0.1:${endpoint.port}/terminal?token=${encodeURIComponent(endpoint.token)}`,
    );
    const opened = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS);
        socket.onopen = () => {
            clearTimeout(timer);
            resolve(true);
        };
        socket.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
    });
    if (!opened) {
        socket.close();
        return null;
    }
    return new LocalTerminalConnection(machineId, socket);
}

const connections = new Map<string, Promise<LocalTerminalConnection | null>>();
const lastFailure = new Map<string, number>();

/**
 * The loopback connection to `machineId`'s daemon, or null when there is none
 * to be had: off the desktop app, for a machine elsewhere, or a daemon that is
 * not running or is too old to offer one. Null means "use the server".
 *
 * A machine that just failed is not tried again for a few seconds, so a
 * terminal falling back does not knock on a closed port with every call.
 */
export function getLocalTerminalConnection(machineId: string): Promise<LocalTerminalConnection | null> {
    if (!isTauriDesktop()) {
        return Promise.resolve(null);
    }
    const existing = connections.get(machineId);
    if (existing) {
        return existing;
    }
    if (Date.now() - (lastFailure.get(machineId) ?? -Infinity) < RETRY_AFTER_MS) {
        return Promise.resolve(null);
    }
    const connecting: Promise<LocalTerminalConnection | null> = openConnection(machineId)
        .catch(() => null)
        .then((connection) => {
            if (!connection) {
                connections.delete(machineId);
                lastFailure.set(machineId, Date.now());
                return null;
            }
            connection.onClose(() => {
                if (connections.get(machineId) === connecting) {
                    connections.delete(machineId);
                }
            });
            return connection;
        });
    connections.set(machineId, connecting);
    return connecting;
}

/**
 * A terminal call to a machine, by loopback when the daemon is on this
 * computer and through the server otherwise.
 *
 * Falls back only when the call never left. One cut off on its way may already
 * have run, and sending a `terminal-spawn` twice would start two shells.
 */
export async function terminalRPC<R, A>(
    machineId: string,
    method: LocalTerminalMethod,
    params: A,
    timeout = DEFAULT_RPC_TIMEOUT_MS,
): Promise<R> {
    const local = await getLocalTerminalConnection(machineId);
    if (local) {
        try {
            return await local.rpc<R, A>(method, params, timeout);
        } catch (error) {
            if (!(error instanceof LocalTerminalUnavailableError)) {
                throw error;
            }
        }
    }
    return await apiSocket.machineRPC<R, A>(machineId, method, params, timeout);
}

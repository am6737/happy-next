/**
 * Daemon-side owner of terminal sessions.
 *
 * Holds no PTY itself — every terminal lives in the forked worker (see
 * terminalWorkerProcess.ts). This class is the only thing the rest of the
 * daemon talks to: it turns RPC-shaped calls into worker requests, batches the
 * worker's output, and fans it out to whoever is watching.
 *
 * A terminal may also be one that outlived the daemon. tmux keeps those alive,
 * so this class starts by asking it what is still running and takes the answer
 * as its own list (see `recover`).
 */

import { fork, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';
import { TerminalOutputCoalescer } from './terminalOutputCoalescer';
import { isTerminalTmuxAvailable, listTerminalSessions } from './terminalTmux';
import type { TerminalInfo, TerminalState } from 'happy-wire';
import type {
    TerminalWorkerMessage,
    TerminalWorkerRequest,
    TerminalWorkerRequestInput,
    WorkerCreateOptions,
    WorkerTerminalSize,
} from './terminalWorkerProtocol';
import { isWorkerEvent } from './terminalWorkerProtocol';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A terminal event, tapped globally rather than per-subscriber.
 *
 * The daemon relays these to the server for fan-out, so they must be observed
 * whether or not anything is attached — a passive tap, unlike `subscribe`,
 * which replays a snapshot to one specific caller.
 */
export type TerminalEvent =
    | { type: 'output'; terminalId: string; data: string }
    | { type: 'title'; terminalId: string; title: string | undefined }
    | { type: 'exit'; terminalId: string; exitCode: number | null; signal: number | null };

export interface TerminalOutputListener {
    onOutput(data: string): void;
    onState(state: TerminalState): void;
    onExit(exitCode: number | null, signal: number | null): void;
    onTitle(title: string | undefined): void;
}

interface TerminalRecord {
    info: TerminalInfo;
    listeners: Set<TerminalOutputListener>;
    coalescer: TerminalOutputCoalescer;
    /** Output that arrived before the first subscriber attached. */
    pendingOutput: string[];
    /** Latest known screen, kept so a reattach needs no worker round trip. */
    state: TerminalState | null;
    exitCode: number | null;
    signal: number | null;
    exited: boolean;
    /**
     * Whether the worker currently holds a PTY for this terminal. A terminal
     * recovered from tmux starts detached: the shell is running, but nothing
     * here is watching it until something looks.
     */
    attached: boolean;
    /** In-flight attach, so concurrent callers share one instead of racing. */
    attaching: Promise<void> | null;
}

interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface CreateTerminalRequest {
    id?: string;
    /** Defaults to the daemon account's home directory; see `create`. */
    cwd?: string;
    shell?: string;
    args?: string[];
    env?: Record<string, string>;
    size?: WorkerTerminalSize;
}

export interface TerminalManagerOptions {
    /**
     * Put shells under tmux so they outlive this process. Left unset the
     * machine is asked, which is what the daemon wants; a caller that only
     * cares about the terminal itself, as the tests do, turns it off and gets
     * plain PTYs on every machine.
     */
    durable?: boolean;
}

/**
 * Starts the worker process.
 *
 * The paths are taken from the package root rather than from this module,
 * because bundling folds this file into a shared chunk — a path relative to
 * `import.meta.url` would point at the chunk, not at the worker.
 *
 * Two shapes, because this module runs both built (the daemon) and from source
 * (vitest/tsx):
 *  - built `dist/terminal/worker.mjs` — plain `fork`, and the child inherits
 *    the IPC channel. The file exists because `package.json` declares it as an
 *    export; pkgroll only emits entries it finds there.
 *  - source `.ts` — `fork` cannot load TypeScript, so spawn node with the tsx
 *    loader, whose register hook installs the IPC channel itself.
 */
function startWorkerProcess(): ChildProcess {
    const compiled = join(projectPath(), 'dist', 'modules', 'terminal', 'terminalWorkerProcess.mjs');
    if (existsSync(compiled)) {
        return fork(compiled, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    }

    const source = join(projectPath(), 'src', 'modules', 'terminal', 'terminalWorkerProcess.ts');
    if (!existsSync(source)) {
        throw new Error(`Terminal worker entry not found (looked for ${compiled} and ${source})`);
    }

    return spawn(process.execPath, ['--import', 'tsx', source], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
}

export class TerminalManager {
    private worker: ChildProcess | null = null;
    private readonly terminals = new Map<string, TerminalRecord>();
    private readonly pending = new Map<string, PendingRequest>();
    private readonly anyEventListeners = new Set<(event: TerminalEvent) => void>();
    private nextRequestId = 0;
    private stopping = false;
    /** Set once tmux has been found, which decides whether a restart is a loss. */
    private tmux = false;
    private recovery: Promise<void> | null = null;

    constructor(private readonly options: TerminalManagerOptions = {}) {}

    start(): void {
        if (this.worker) {
            return;
        }

        this.worker = startWorkerProcess();

        this.worker.on('message', (message: TerminalWorkerMessage) => {
            this.handleWorkerMessage(message);
        });

        this.worker.on('exit', () => {
            this.handleWorkerExit();
        });

        // Asked once per daemon, because it is the daemon that is new — the
        // shells tmux is holding are the ones from the run before this.
        this.recovery ??= this.ensureDurability().then(
            () => undefined,
            (error) => {
                logger.debug('[terminals] could not take back terminals from tmux', error);
            },
        );
    }

    /**
     * Turns durability on, if this machine can do it.
     *
     * Asked at startup and asked again on any terminal created while the answer
     * is still no. tmux can be installed while the daemon runs, and going on
     * ignoring it until the next restart — with nothing said — is the same
     * silent failure the layer exists to avoid. A yes is kept: tmux does not go
     * away in a way anything here could act on.
     */
    private async ensureDurability(): Promise<boolean> {
        if (this.options.durable === false) {
            return false;
        }
        if (this.tmux) {
            return true;
        }
        if (!(await isTerminalTmuxAvailable())) {
            return false;
        }
        // Checked again: another caller may have got this far while this one
        // was waiting on the probe.
        if (this.tmux) {
            return true;
        }

        this.tmux = true;
        logger.debug('[terminals] tmux is available; shells will outlive this daemon');

        try {
            // Taken over here rather than only at startup, because durability
            // may have been switched on long after this daemon began.
            await this.adoptSessions();
        } catch (error) {
            // Losing the adoption is not worth losing the terminal that is
            // being created: the shells stay in tmux and the next listing
            // finds them.
            logger.debug('[terminals] could not take back terminals from tmux', error);
        }
        return true;
    }

    /**
     * Takes over the shells that outlived the last daemon.
     *
     * tmux holds them, so a restart is a detach rather than an end: the shells
     * are still running and listing them here is what puts their tabs back on
     * screen. No PTY is opened until something actually looks — a terminal
     * nobody opens should not cost a client process.
     */
    private async adoptSessions(): Promise<void> {
        for (const session of await listTerminalSessions()) {
            if (this.terminals.has(session.id)) {
                continue;
            }
            this.terminals.set(
                session.id,
                this.createRecord({
                    info: {
                        id: session.id,
                        cwd: session.cwd,
                        ...(session.title ? { title: session.title } : {}),
                        size: { rows: session.rows, cols: session.cols },
                        exited: false,
                    },
                    attached: false,
                }),
            );
            logger.debug(`[terminals] took back ${session.id} from tmux`);
        }
    }

    private createRecord(init: { info: TerminalInfo; attached: boolean }): TerminalRecord {
        const record: TerminalRecord = {
            info: init.info,
            listeners: new Set(),
            coalescer: new TerminalOutputCoalescer({
                onFlush: (data) => {
                    record.pendingOutput.push(data);
                    for (const listener of record.listeners) {
                        listener.onOutput(data);
                    }
                    this.emitAnyEvent({ type: 'output', terminalId: record.info.id, data });
                },
            }),
            pendingOutput: [],
            state: null,
            exitCode: null,
            signal: null,
            exited: false,
            attached: init.attached,
            attaching: null,
        };
        return record;
    }

    /**
     * Opens a PTY onto a terminal whose shell is already running under tmux.
     *
     * Deliberately strict about the session still being there: attaching with
     * `new-session -A` would quietly start a fresh shell in place of the one
     * that ended while the daemon was away, and a tab that comes back as a
     * different shell is worse than one that reports it is gone.
     */
    private attachRecord(record: TerminalRecord): Promise<void> {
        record.attaching ??= this.send({
            type: 'create',
            options: {
                id: record.info.id,
                cwd: record.info.cwd,
                size: record.info.size,
                reattach: true,
                tmux: true,
            },
        })
            .then(() => {
                record.attached = true;
            })
            .finally(() => {
                record.attaching = null;
            });
        return record.attaching;
    }

    private async ensureAttached(record: TerminalRecord): Promise<void> {
        if (!record.attached) {
            await this.attachRecord(record);
        }
    }

    private emitAnyEvent(event: TerminalEvent): void {
        for (const listener of this.anyEventListeners) {
            listener(event);
        }
    }

    private handleWorkerMessage(message: TerminalWorkerMessage): void {
        if (!isWorkerEvent(message)) {
            const pending = this.pending.get(message.requestId);
            if (!pending) {
                return;
            }
            this.pending.delete(message.requestId);
            clearTimeout(pending.timer);
            if (message.type === 'ok') {
                pending.resolve(message.result);
            } else {
                pending.reject(new Error(message.error));
            }
            return;
        }

        const record = this.terminals.get(message.terminalId);
        if (!record) {
            return;
        }

        if (message.type === 'output') {
            record.coalescer.handle(message.data);
            return;
        }

        if (message.type === 'title') {
            record.info = { ...record.info, ...(message.title ? { title: message.title } : {}) };
            for (const listener of record.listeners) {
                listener.onTitle(message.title);
            }
            this.emitAnyEvent({ type: 'title', terminalId: message.terminalId, title: message.title });
            return;
        }

        record.exited = true;
        record.exitCode = message.exitCode;
        record.signal = message.signal;
        record.info = { ...record.info, exited: true, exitCode: message.exitCode };
        record.coalescer.flush();

        // Freeze the final screen so a later reattach can still show it even
        // once the worker is gone.
        void this.send({ type: 'getState', terminalId: message.terminalId })
            .then((state) => {
                record.state = state as TerminalState;
            })
            .catch(() => {
                // Nothing to freeze — the client just keeps the live screen it has.
            });

        for (const listener of record.listeners) {
            listener.onExit(message.exitCode, message.signal);
        }
        this.emitAnyEvent({
            type: 'exit',
            terminalId: message.terminalId,
            exitCode: message.exitCode,
            signal: message.signal,
        });
    }

    /**
     * The worker died. What that costs depends on where the shells live.
     *
     * Without tmux the PTYs were the worker's and are gone with it, so every
     * watcher is told rather than left on a frozen screen. With tmux they are
     * still running — the worker only held attach clients — so this is a
     * detach, and the next look at a terminal reopens the PTY onto the same
     * shell.
     */
    private handleWorkerExit(): void {
        this.worker = null;

        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Terminal worker exited'));
        }
        this.pending.clear();

        for (const record of this.terminals.values()) {
            if (record.exited) {
                record.coalescer.close();
                continue;
            }

            if (this.tmux) {
                record.attached = false;
                record.attaching = null;
                // Whatever was half-sent is dropped: tmux repaints the whole
                // screen on the next attach, so a gap here heals itself.
                record.pendingOutput = [];
                continue;
            }

            record.coalescer.close();
            record.exited = true;
            record.info = { ...record.info, exited: true };
            for (const listener of record.listeners) {
                listener.onExit(null, null);
            }
        }

        if (!this.stopping) {
            // Rebuild the worker so the next terminal works.
            this.start();
        }
    }

    private send(request: TerminalWorkerRequestInput): Promise<unknown> {
        this.start();
        const worker = this.worker;
        if (!worker?.send) {
            return Promise.reject(new Error('Terminal worker unavailable'));
        }

        this.nextRequestId += 1;
        const requestId = String(this.nextRequestId);

        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Terminal worker request timed out: ${request.type}`));
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(requestId, { resolve, reject, timer });
            worker.send({ ...request, requestId } as TerminalWorkerRequest, (error) => {
                if (!error) {
                    return;
                }
                const entry = this.pending.get(requestId);
                if (!entry) {
                    return;
                }
                this.pending.delete(requestId);
                clearTimeout(entry.timer);
                reject(error);
            });
        });
    }

    async create(request: CreateTerminalRequest): Promise<TerminalInfo> {
        this.start();
        // Asked on every create while the answer is still no, so that installing
        // tmux does not need the daemon restarted before it is noticed. Once it
        // is yes this returns without probing again.
        await this.ensureDurability();

        const id = request.id ?? `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        // The client does not know this machine's filesystem, so the default
        // belongs here rather than there. Home is what a terminal opened with
        // no particular destination should land in.
        const cwd = request.cwd ?? homedir();

        const record = this.createRecord({
            info: {
                id,
                cwd,
                size: request.size ?? { rows: 30, cols: 100 },
                exited: false,
            },
            attached: true,
        });
        this.terminals.set(id, record);

        const options: WorkerCreateOptions = {
            id,
            cwd,
            ...(request.shell ? { shell: request.shell } : {}),
            ...(request.args ? { args: request.args } : {}),
            ...(request.env ? { env: request.env } : {}),
            ...(request.size ? { size: request.size } : {}),
            ...(this.tmux ? { tmux: true } : {}),
        };

        try {
            await this.send({ type: 'create', options });
        } catch (error) {
            this.terminals.delete(id);
            record.coalescer.close();
            throw error;
        }

        return record.info;
    }

    async write(terminalId: string, data: string): Promise<unknown> {
        const record = this.terminals.get(terminalId);
        if (!record) {
            throw new Error(`Unknown terminal ${terminalId}`);
        }
        await this.ensureAttached(record);
        return this.send({ type: 'write', terminalId, data });
    }

    async resize(terminalId: string, size: WorkerTerminalSize): Promise<unknown> {
        const record = this.terminals.get(terminalId);
        if (!record) {
            throw new Error(`Unknown terminal ${terminalId}`);
        }
        record.info = { ...record.info, size };
        await this.ensureAttached(record);
        return this.send({ type: 'resize', terminalId, size });
    }

    async getState(terminalId: string): Promise<TerminalState> {
        const record = this.terminals.get(terminalId);
        if (!record) {
            throw new Error(`Unknown terminal ${terminalId}`);
        }

        // Only a finished terminal has a screen worth caching — while it is
        // running, any snapshot is stale the moment the next byte arrives.
        if (record.state) {
            return record.state;
        }

        try {
            await this.ensureAttached(record);
            const state = (await this.send({ type: 'getState', terminalId })) as TerminalState;
            if (record.exited) {
                record.state = state;
            }
            return state;
        } catch (error) {
            // A dead worker still lets the client render the last known screen.
            if (record.state) {
                return record.state;
            }
            throw error;
        }
    }

    /**
     * Attaches a viewer and replays what it missed.
     *
     * Ordering matters: the listener is registered *before* the screen is
     * fetched, and output that arrived in between is held in `pendingOutput`.
     * The client is then sent the screen followed by exactly that backlog — so
     * nothing is dropped and nothing is applied twice.
     */
    async subscribe(terminalId: string, listener: TerminalOutputListener): Promise<() => void> {
        const record = this.terminals.get(terminalId);
        if (!record) {
            throw new Error(`Unknown terminal ${terminalId}`);
        }

        record.listeners.add(listener);

        let state: TerminalState | null = null;
        try {
            state = await this.getState(terminalId);
        } catch {
            // A dead worker still lets the client render the last known screen.
            state = record.state;
        }

        const backlog = record.pendingOutput;
        record.pendingOutput = [];

        if (state) {
            listener.onState(state);
        }
        for (const chunk of backlog) {
            listener.onOutput(chunk);
        }
        if (record.exited) {
            listener.onExit(record.exitCode, record.signal);
        }

        return () => {
            record.listeners.delete(listener);
        };
    }

    /**
     * Stops the process but keeps the record, so the final screen stays
     * readable and a tmux-backed terminal can be reattached.
     */
    async kill(terminalId: string): Promise<void> {
        await this.send({ type: 'kill', terminalId });
    }

    /** Stops and forgets a terminal. */
    async dispose(terminalId: string): Promise<void> {
        const record = this.terminals.get(terminalId);
        if (!record) {
            return;
        }
        try {
            await this.send({ type: 'dispose', terminalId });
        } catch {
            // Already gone — dropping the record is the point.
        }
        record.coalescer.close();
        record.listeners.clear();
        this.terminals.delete(terminalId);
    }

    /** Observes output, titles and exits for every terminal. See TerminalEvent. */
    onAnyEvent(listener: (event: TerminalEvent) => void): () => void {
        this.anyEventListeners.add(listener);
        return () => this.anyEventListeners.delete(listener);
    }

    /**
     * Every terminal this daemon knows about, including the ones it inherited.
     *
     * Waits for recovery, because the answer to "what terminals are there" is
     * not known until tmux has been asked — and a client asking early would
     * otherwise be told its terminals are gone.
     */
    async list(): Promise<TerminalInfo[]> {
        this.start();
        await this.recovery;
        return [...this.terminals.values()].map((record) => record.info);
    }

    /** Shuts the worker down. Call on daemon exit. */
    stop(): void {
        this.stopping = true;

        for (const record of this.terminals.values()) {
            record.coalescer.close();
            record.listeners.clear();
        }
        this.terminals.clear();
        this.anyEventListeners.clear();

        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Terminal manager stopped'));
        }
        this.pending.clear();

        this.worker?.disconnect();
        this.worker?.kill();
        this.worker = null;
    }
}

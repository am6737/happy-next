import type {
    TerminalFrameBody,
    TerminalRelayedFrame,
    TerminalAttachResponse,
    TerminalOkResponse,
    TerminalInputRequest,
    TerminalResizeRequest,
} from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import { storage } from '@/sync/storage';
import { createNativeHeadlessTerminal, type NativeHeadlessTerminal, type TerminalViewportState } from './headlessTerminalState';

export interface TerminalStreamStatus {
    attaching: boolean;
    error: string | null;
    /**
     * The daemon this terminal lives on is not connected.
     *
     * The screen holds whatever the last frame left and nothing more is coming,
     * but the shell behind it is still running — so this is a wait rather than
     * a loss, and the screen is worth reading in the meantime.
     */
    offline: boolean;
}

/**
 * Whether the machine behind a terminal is connected.
 *
 * A machine's flag is absent until the first activity update arrives, and
 * absent is not offline: only an explicit false is the server saying the daemon
 * went away, and anything looser would announce an outage it cannot know about.
 */
function machineIsConnected(machineId: string): boolean {
    return storage.getState().machines[machineId]?.active !== false;
}

/**
 * Calls back when a machine's connection state changes.
 *
 * The app and the daemon reach the server over connections that fail
 * independently, so the daemon restarting disturbs nothing this screen could
 * notice on its own socket. The server broadcasts the machine's comings and
 * goings to the app instead, and the app keeps them on the machine — which is
 * what this reads.
 */
function watchMachineConnection(
    machineId: string,
    listener: (connected: boolean) => void,
): () => void {
    let connected = machineIsConnected(machineId);
    return storage.subscribe(() => {
        const next = machineIsConnected(machineId);
        if (next !== connected) {
            connected = next;
            listener(next);
        }
    });
}

export interface TerminalStreamOptions {
    machineId: string;
    terminalId: string;
    size: { rows: number; cols: number };
    /** Called with a fresh screen whenever the mirror changes. */
    onViewport: (state: TerminalViewportState) => void;
    onStatus: (status: TerminalStreamStatus) => void;
    onTitle: (title: string | undefined) => void;
    onExit: (info: { exitCode: number | null; signal: number | null }) => void;
}

/**
 * One attached terminal: the socket subscription, the local screen mirror, and
 * the sequencing that keeps the two honest.
 *
 * The server relays raw terminal output, so the client has to run an emulator
 * of its own — there is no "here is the current screen, now apply these deltas"
 * shortcut that survives a reconnect. The mirror is seeded by replaying an
 * ANSI rendering of the daemon's screen (see the snapshot frame) and then fed
 * every delta that follows.
 */
export class TerminalStream {
    private mirror: NativeHeadlessTerminal;
    private size: { rows: number; cols: number };
    private unsubscribeFrame: (() => void) | null = null;
    private unsubscribeReconnect: (() => void) | null = null;
    private unsubscribeMachine: (() => void) | null = null;
    private disposed = false;
    private status: TerminalStreamStatus = { attaching: true, error: null, offline: false };
    /**
     * The revision of the snapshot the mirror currently reflects. Deltas at or
     * below it are already folded into that screen and must be dropped, or a
     * frame that raced the attach would be applied twice.
     */
    private baselineRevision = -1;
    private lastAppliedRevision = -1;
    /** Frames that arrived before the snapshot, held so they can be discarded. */
    private sawSnapshot = false;

    constructor(private readonly options: TerminalStreamOptions) {
        this.size = options.size;
        this.mirror = createNativeHeadlessTerminal({
            rows: options.size.rows,
            cols: options.size.cols,
        });
    }

    start(): void {
        // A machine that is already away when the screen opens never changes
        // state, so nothing would report it. The attach below still runs — a
        // stale flag must not be able to leave a terminal permanently blank.
        this.setStatus({
            attaching: true,
            error: null,
            offline: !machineIsConnected(this.options.machineId),
        });

        this.unsubscribeFrame = apiSocket.onMessage('terminal-frame', (frame: TerminalRelayedFrame) => {
            void this.handleFrame(frame);
        });
        // The server drops subscriptions when the socket goes away, so a
        // reconnect has to re-subscribe and re-attach from scratch.
        this.unsubscribeReconnect = apiSocket.onReconnected(() => {
            void this.attach();
        });
        this.unsubscribeMachine = watchMachineConnection(this.options.machineId, (connected) => {
            if (connected) {
                // Nothing on screen is trustworthy any more: it is what the
                // daemon that left had drawn. Rebuilding is the only way back to
                // a screen that matches the shell.
                void this.attach();
                return;
            }
            // Reached only when the server says so, or for a machine in this
            // account that has never been online. The shell is not lost with
            // the daemon — tmux holds it, and the next one will find it.
            this.setStatus({ attaching: false, error: null, offline: true });
        });

        void this.attach();
    }

    private setStatus(patch: Partial<TerminalStreamStatus>): void {
        this.status = { ...this.status, ...patch };
        this.options.onStatus(this.status);
    }

    private async attach(): Promise<void> {
        if (this.disposed) {
            return;
        }

        const { machineId, terminalId } = this.options;
        this.setStatus({ attaching: true, error: null });
        try {
            const subscribed = await apiSocket.emitWithAck<{ ok: boolean; error?: string }>(
                'terminal-subscribe',
                { machineId, terminalId },
            );
            if (!subscribed?.ok) {
                // The relay refuses terminals whose machine this account does not
                // own, and a subscription that was rejected would leave the
                // screen waiting for frames that are never coming.
                throw new Error(subscribed?.error ?? 'Unable to subscribe to terminal');
            }

            // Claim the size before attaching so the snapshot is rendered at the
            // width this client will draw. Without it the first screen arrives at
            // whatever size the last viewer left behind.
            await apiSocket.machineRPC<TerminalOkResponse, TerminalResizeRequest>(machineId, 'terminal-resize', {
                terminalId,
                rows: this.size.rows,
                cols: this.size.cols,
            });

            // A fresh attach invalidates the old baseline: the next snapshot
            // becomes the screen of record regardless of what came before.
            this.sawSnapshot = false;

            await apiSocket.machineRPC<TerminalAttachResponse, { terminalId: string }>(
                machineId,
                'terminal-attach',
                { terminalId },
            );

            // Reaching the daemon at all settles the offline question, and the
            // snapshot below is what makes the screen current again.
            this.setStatus({ attaching: false, error: null, offline: false });
        } catch (error) {
            if (this.disposed) {
                return;
            }
            this.setStatus({
                attaching: false,
                error: error instanceof Error ? error.message : 'Unable to attach to terminal',
            });
        }
    }

    private async handleFrame(frame: TerminalRelayedFrame): Promise<void> {
        if (this.disposed || !frame || frame.terminalId !== this.options.terminalId) {
            return;
        }
        // Frames for other machines can only arrive if the relay misrouted
        // them; the daemon that sent this one is the only writer we accept.
        if (frame.machineId !== this.options.machineId) {
            return;
        }

        const body = await apiSocket.decryptMachinePayload<TerminalFrameBody>(
            this.options.machineId,
            frame.payload,
        );
        // A payload that will not decrypt is not ours to render, and retrying
        // would not help — drop it rather than tearing down a working screen.
        if (!body || this.disposed) {
            return;
        }

        if (body.type === 'snapshot') {
            await this.applySnapshot(frame.revision, body);
            return;
        }

        if (!this.sawSnapshot) {
            // Already contained in the snapshot still on its way here.
            return;
        }

        if (frame.revision <= this.baselineRevision) {
            return;
        }

        if (frame.revision !== this.lastAppliedRevision + 1) {
            // Output went missing, so the mirror no longer matches the daemon.
            // Rendering on would show a screen with a silent hole in it, so
            // rebuild from a fresh snapshot instead.
            await this.attach();
            return;
        }

        this.lastAppliedRevision = frame.revision;
        await this.applyDelta(body);
    }

    private async applySnapshot(
        revision: number,
        body: Extract<TerminalFrameBody, { type: 'snapshot' }>,
    ): Promise<void> {
        this.mirror.dispose();
        this.mirror = createNativeHeadlessTerminal({ rows: body.rows, cols: body.cols });
        this.size = { rows: body.rows, cols: body.cols };

        await this.mirror.write(body.ansi);

        this.baselineRevision = revision;
        this.lastAppliedRevision = revision;
        this.sawSnapshot = true;
        this.publishViewport();
    }

    private async applyDelta(body: Exclude<TerminalFrameBody, { type: 'snapshot' }>): Promise<void> {
        if (body.type === 'output') {
            await this.mirror.write(body.data);
            this.publishViewport();
            return;
        }
        if (body.type === 'title') {
            this.options.onTitle(body.title);
            return;
        }
        this.options.onExit({ exitCode: body.exitCode, signal: body.signal });
    }

    private publishViewport(): void {
        if (this.disposed) {
            return;
        }
        this.options.onViewport(this.mirror.getViewportState());
    }

    /** Sends keystrokes to the shell. */
    write(data: string): void {
        if (this.disposed || data.length === 0) {
            return;
        }
        void apiSocket
            .machineRPC<TerminalOkResponse, TerminalInputRequest>(this.options.machineId, 'terminal-input', {
                terminalId: this.options.terminalId,
                data,
            })
            .catch(() => {
                // A dropped keystroke is not worth tearing the screen down for;
                // the socket's own reconnect path will re-attach if it is gone.
            });
    }

    /** Resizes the shell to match the view. */
    resize(size: { rows: number; cols: number }): void {
        if (this.disposed || (size.rows === this.size.rows && size.cols === this.size.cols)) {
            return;
        }
        this.size = size;
        this.mirror.resize(size);
        this.publishViewport();

        void apiSocket
            .machineRPC<TerminalOkResponse, TerminalResizeRequest>(this.options.machineId, 'terminal-resize', {
                terminalId: this.options.terminalId,
                rows: size.rows,
                cols: size.cols,
            })
            .catch(() => {
                // Same reasoning as write(): the next attach re-claims the size.
            });
    }

    /** The DECCKM / bracketed-paste flags the shell currently has set. */
    getInputMode() {
        return this.mirror.getInputModeState();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.unsubscribeFrame?.();
        this.unsubscribeReconnect?.();
        this.unsubscribeMachine?.();
        this.unsubscribeFrame = null;
        this.unsubscribeReconnect = null;
        this.unsubscribeMachine = null;
        this.mirror.dispose();

        // The subscription is per-socket and the socket outlives this screen,
        // so release it explicitly — otherwise frames keep arriving for a
        // terminal nobody is watching.
        void apiSocket.emitWithAck('terminal-unsubscribe', {
            machineId: this.options.machineId,
            terminalId: this.options.terminalId,
        }).catch(() => {
            // The socket may already be gone, which releases it anyway.
        });
    }
}

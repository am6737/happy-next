/**
 * Exposes terminal sessions over the machine's RPC surface.
 *
 * Output does not travel over RPC — it goes out through the daemon's stream
 * forwarding, because `rpc-call` costs a full round trip per message and a
 * busy command emits hundreds of frames a second.
 *
 * Snapshot and output share that one stream on purpose. Attaching pushes the
 * screen as an ordinary frame, and everything after it follows in order on the
 * same socket, so a client can render whatever arrives without needing to
 * reconcile two paths that could interleave differently.
 */

import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { encodeBase64, encrypt } from '@/api/encryption';
import type {
    TerminalAttachResponse,
    TerminalFrame,
    TerminalFrameBody,
    TerminalInfo,
    TerminalInputRequest,
    TerminalOkResponse,
    TerminalRefRequest,
    TerminalResizeRequest,
    TerminalSpawnRequest,
    TerminalState,
} from 'happy-wire';
import { TerminalManager, type TerminalEvent } from './terminalManager';
import { renderTerminalStateToAnsi } from './terminalSnapshotAnsi';

export interface TerminalHandlerOptions {
    machineId: string;
    encryptionKey: Uint8Array;
    encryptionVariant: 'legacy' | 'dataKey';
    /** Relays one frame to the server. Implementations must tolerate a closed socket. */
    sendFrame: (frame: TerminalFrame) => void;
    /**
     * Put shells under tmux so they outlive the daemon. Left unset the machine
     * is asked; see `TerminalManagerOptions`.
     */
    durable?: boolean;
}

export function registerTerminalHandlers(
    rpcHandlerManager: RpcHandlerManager,
    options: TerminalHandlerOptions,
): TerminalManager {
    const manager = new TerminalManager({ durable: options.durable });
    const revisions = new Map<string, number>();

    function pushFrame(terminalId: string, body: TerminalFrameBody): number {
        const revision = (revisions.get(terminalId) ?? 0) + 1;
        revisions.set(terminalId, revision);
        options.sendFrame({
            terminalId,
            revision,
            payload: encodeBase64(encrypt(options.encryptionKey, options.encryptionVariant, body)),
        });
        return revision;
    }

    manager.onAnyEvent((event: TerminalEvent) => {
        if (event.type === 'output') {
            pushFrame(event.terminalId, { type: 'output', data: event.data });
            return;
        }
        if (event.type === 'title') {
            pushFrame(event.terminalId, { type: 'title', title: event.title });
            return;
        }
        pushFrame(event.terminalId, {
            type: 'exit',
            exitCode: event.exitCode,
            signal: event.signal,
        });
    });

    rpcHandlerManager.registerHandler<TerminalSpawnRequest, Awaited<ReturnType<TerminalManager['create']>>>(
        'terminal-spawn',
        (request) =>
            manager.create({
                ...(request.id ? { id: request.id } : {}),
                ...(request.cwd ? { cwd: request.cwd } : {}),
                ...(request.shell ? { shell: request.shell } : {}),
                ...(request.args ? { args: request.args } : {}),
                ...(request.env ? { env: request.env } : {}),
                ...(request.rows && request.cols ? { size: { rows: request.rows, cols: request.cols } } : {}),
            }),
    );

    // Pushes the current screen onto the stream and reports the revision it was
    // sent at, so the client can tell whether the first frame it sees is the
    // snapshot or a later delta.
    rpcHandlerManager.registerHandler<TerminalRefRequest, TerminalAttachResponse>(
        'terminal-attach',
        async (request) => {
            const state = await manager.getState(request.terminalId);
            return {
                revision: pushFrame(request.terminalId, {
                    type: 'snapshot',
                    ansi: renderTerminalStateToAnsi(state),
                    rows: state.rows,
                    cols: state.cols,
                }),
            };
        },
    );

    rpcHandlerManager.registerHandler<TerminalInputRequest, TerminalOkResponse>('terminal-input', async (request) => {
        await manager.write(request.terminalId, request.data);
        return { ok: true };
    });

    rpcHandlerManager.registerHandler<TerminalResizeRequest, TerminalOkResponse>('terminal-resize', async (request) => {
        await manager.resize(request.terminalId, { rows: request.rows, cols: request.cols });
        return { ok: true };
    });

    // Stops the process but keeps the session, so the final screen stays
    // readable and a tmux-backed shell can be reattached.
    rpcHandlerManager.registerHandler<TerminalRefRequest, TerminalOkResponse>('terminal-close', async (request) => {
        await manager.kill(request.terminalId);
        return { ok: true };
    });

    rpcHandlerManager.registerHandler<TerminalRefRequest, TerminalOkResponse>('terminal-dispose', async (request) => {
        revisions.delete(request.terminalId);
        await manager.dispose(request.terminalId);
        return { ok: true };
    });

    rpcHandlerManager.registerHandler<Record<string, never>, TerminalInfo[]>(
        'terminal-list',
        () => manager.list(),
    );

    // Pull-based read of the screen, for callers that are not on the stream.
    rpcHandlerManager.registerHandler<TerminalRefRequest, TerminalState>('terminal-state', (request) =>
        manager.getState(request.terminalId),
    );

    return manager;
}

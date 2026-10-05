import { Socket } from "socket.io";
import { log } from "@/utils/log";
import { activityCache } from "@/app/presence/sessionCache";
import type { ClientConnection } from "@/app/events/eventRouter";
import type { TerminalFrame, TerminalRelayedFrame } from "happy-wire";

/**
 * Terminal output streaming.
 *
 * Terminal output cannot ride the existing RPC path: `rpc-call` forwards via
 * `emitWithAck` with a 30s timeout, so every frame would cost a full
 * daemon→server→client→server→daemon round trip. A busy command emits hundreds
 * of frames a second, which that design cannot carry.
 *
 * So frames travel as plain one-way events here, with the server acting purely
 * as a relay: it never parses the payload. `payload` stays E2E encrypted with
 * the machine key, exactly like message content — terminal output routinely
 * contains tokens, connection strings and other secrets, so the server must not
 * be able to read it.
 *
 * `revision` is deliberately left in the clear. It is a counter, not content,
 * and the client needs it outside the ciphertext to discard frames that were
 * already folded into the screen snapshot it attached with.
 */

/** `${machineId}:${terminalId}` — terminal ids are only unique per machine. */
type TerminalKey = string;

/** Sockets currently watching each terminal. */
const subscribers = new Map<TerminalKey, Set<Socket>>();

function terminalKey(machineId: string, terminalId: string): TerminalKey {
    return `${machineId}:${terminalId}`;
}

function removeSubscriber(key: TerminalKey, socket: Socket): void {
    const sockets = subscribers.get(key);
    if (!sockets) {
        return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
        subscribers.delete(key);
    }
}

interface TerminalSubscribeRequest {
    machineId: string;
    terminalId: string;
}

export function terminalStreamHandler(userId: string, socket: Socket, connection: ClientConnection) {

    // A client asks to receive a terminal's output. Access is gated on machine
    // ownership: terminals run with the daemon's full environment, so this is
    // stricter than the shared-session RPC allowlist by design.
    socket.on('terminal-subscribe', async (data: TerminalSubscribeRequest, callback: (response: { ok: boolean; error?: string }) => void) => {
        try {
            const machineId = data?.machineId;
            const terminalId = data?.terminalId;

            if (typeof machineId !== 'string' || typeof terminalId !== 'string' || !machineId || !terminalId) {
                callback?.({ ok: false, error: 'Invalid parameters' });
                return;
            }

            const allowed = await activityCache.isMachineValid(machineId, userId);
            if (!allowed) {
                callback?.({ ok: false, error: 'Forbidden' });
                return;
            }

            const key = terminalKey(machineId, terminalId);
            let sockets = subscribers.get(key);
            if (!sockets) {
                sockets = new Set();
                subscribers.set(key, sockets);
            }
            sockets.add(socket);

            callback?.({ ok: true });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in terminal-subscribe: ${error}`);
            callback?.({ ok: false, error: 'Internal error' });
        }
    });

    socket.on('terminal-unsubscribe', (data: TerminalSubscribeRequest) => {
        const machineId = data?.machineId;
        const terminalId = data?.terminalId;
        if (typeof machineId !== 'string' || typeof terminalId !== 'string') {
            return;
        }
        removeSubscriber(terminalKey(machineId, terminalId), socket);
    });

    // A daemon publishes output for one of its terminals. The machine id is read
    // from the connection rather than the frame so a client cannot inject
    // frames into another machine's stream.
    socket.on('terminal-frame', (data: TerminalFrame) => {
        if (connection.connectionType !== 'machine-scoped') {
            return;
        }

        const terminalId = data?.terminalId;
        if (typeof terminalId !== 'string' || !terminalId) {
            return;
        }
        if (typeof data?.revision !== 'number' || typeof data?.payload !== 'string') {
            return;
        }

        const sockets = subscribers.get(terminalKey(connection.machineId, terminalId));
        if (!sockets || sockets.size === 0) {
            return;
        }

        const frame: TerminalRelayedFrame = {
            machineId: connection.machineId,
            terminalId,
            revision: data.revision,
            payload: data.payload,
        };

        for (const subscriber of sockets) {
            // A socket that dropped mid-iteration is cleaned up by its own
            // disconnect handler; skipping it here keeps the loop simple.
            if (subscriber.connected) {
                subscriber.emit('terminal-frame', frame);
            }
        }
    });

    socket.on('disconnect', () => {
        // Without this the registry would keep dead sockets for every terminal
        // the client ever opened, and frames would be emitted into the void.
        for (const [key, sockets] of subscribers) {
            if (sockets.has(socket)) {
                removeSubscriber(key, socket);
            }
        }
    });
}

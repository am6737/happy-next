/**
 * Terminals over loopback, for a desktop client on this same computer.
 *
 * Through the server every keystroke goes out to the relay and back, which is
 * felt on each character and leaves an open terminal dead whenever the server
 * is. A client that can reach the daemon directly has no reason to pay either,
 * so the control server also accepts a WebSocket at `/terminal` carrying the
 * same encrypted RPC and the same frames the relay would.
 *
 * Two locks guard it. The upgrade needs the token the daemon wrote into its
 * state file, which only this account can read — a web page can open sockets to
 * 127.0.0.1 but never learn it. And every call is encrypted with the machine
 * key and goes through the RPC handler, which refuses plaintext, so even the
 * token alone runs nothing. Only terminal methods answer here.
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
    LOCAL_TERMINAL_METHODS,
    type LocalTerminalClientMessage,
    type LocalTerminalServerMessage,
    type TerminalFrame,
} from 'happy-wire';
import { logger } from '@/ui/logger';

const LOCAL_TERMINAL_PATH = '/terminal';
const allowedMethods = new Set<string>(LOCAL_TERMINAL_METHODS);

export interface LocalTerminalServerOptions {
    server: Server;
    token: string;
    /** Runs one encrypted call through the machine's RPC handlers; answers encrypted. */
    handleRequest: (method: string, params: string) => Promise<unknown>;
    /** Calls back with every frame the daemon pushes, for as long as the server runs. */
    onFrame: (listener: (frame: TerminalFrame) => void) => () => void;
}

function tokenMatches(request: IncomingMessage, token: string): boolean {
    const given = new URL(request.url ?? '', 'http://127.0.0.1').searchParams.get('token') ?? '';
    const expected = Buffer.from(token);
    const actual = Buffer.from(given);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function startLocalTerminalServer(options: LocalTerminalServerOptions): { stop: () => void } {
    const wss = new WebSocketServer({ noServer: true });
    const subscribers = new Map<string, Set<WebSocket>>();

    function send(socket: WebSocket, message: LocalTerminalServerMessage): void {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }

    const stopFrames = options.onFrame((frame) => {
        for (const socket of subscribers.get(frame.terminalId) ?? []) {
            send(socket, { type: 'frame', frame });
        }
    });

    function handleMessage(socket: WebSocket, message: LocalTerminalClientMessage): void {
        if (message.type === 'subscribe') {
            const sockets = subscribers.get(message.terminalId) ?? new Set<WebSocket>();
            sockets.add(socket);
            subscribers.set(message.terminalId, sockets);
            return;
        }
        if (message.type === 'unsubscribe') {
            subscribers.get(message.terminalId)?.delete(socket);
            return;
        }
        // Plaintext params would let the handler skip decryption, and with it the
        // proof that the caller holds the machine key.
        if (!allowedMethods.has(message.method) || typeof message.params !== 'string') {
            send(socket, { type: 'rpc-result', id: message.id, error: 'Method not available locally' });
            return;
        }
        void options.handleRequest(message.method, message.params).then((result) => {
            send(socket, { type: 'rpc-result', id: message.id, result: result as string });
        });
    }

    wss.on('connection', (socket) => {
        logger.debug('[LOCAL TERMINAL] Client connected');
        socket.on('message', (data) => {
            try {
                handleMessage(socket, JSON.parse(data.toString()) as LocalTerminalClientMessage);
            } catch (error) {
                logger.debug('[LOCAL TERMINAL] Dropped a malformed message', error);
            }
        });
        socket.on('close', () => {
            for (const [terminalId, sockets] of subscribers) {
                sockets.delete(socket);
                if (sockets.size === 0) {
                    subscribers.delete(terminalId);
                }
            }
        });
    });

    const onUpgrade = (request: IncomingMessage, stream: Duplex, head: Buffer) => {
        const path = new URL(request.url ?? '', 'http://127.0.0.1').pathname;
        if (path !== LOCAL_TERMINAL_PATH || !tokenMatches(request, options.token)) {
            stream.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            stream.destroy();
            return;
        }
        wss.handleUpgrade(request, stream, head, (socket) => wss.emit('connection', socket, request));
    };
    options.server.on('upgrade', onUpgrade);

    return {
        stop: () => {
            options.server.off('upgrade', onUpgrade);
            stopFrames();
            for (const socket of wss.clients) {
                socket.terminate();
            }
            wss.close();
        },
    };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { LocalTerminalServerMessage, TerminalFrame } from 'happy-wire';
import { startLocalTerminalServer } from './localTerminalServer';

const TOKEN = 'secret-token';

interface Harness {
    port: number;
    handleRequest: ReturnType<typeof vi.fn>;
    pushFrame: (frame: TerminalFrame) => void;
    stop: () => void;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
});

async function startHarness(): Promise<Harness> {
    const server: Server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const listeners = new Set<(frame: TerminalFrame) => void>();
    const handleRequest = vi.fn(async (method: string, params: string) => `answer:${method}:${params}`);
    const { stop } = startLocalTerminalServer({
        server,
        token: TOKEN,
        handleRequest,
        onFrame: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    });
    cleanups.push(stop);

    return {
        port: (server.address() as AddressInfo).port,
        handleRequest,
        pushFrame: (frame) => listeners.forEach((listener) => listener(frame)),
        stop,
    };
}

function connect(port: number, token = TOKEN, path = '/terminal'): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${path}?token=${encodeURIComponent(token)}`);
        socket.once('open', () => {
            cleanups.push(() => socket.terminate());
            resolve(socket);
        });
        socket.once('error', reject);
    });
}

function nextMessage(socket: WebSocket): Promise<LocalTerminalServerMessage> {
    return new Promise((resolve) => {
        socket.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
}

describe('startLocalTerminalServer', () => {
    it('refuses a connection without the token', async () => {
        const { port } = await startHarness();
        await expect(connect(port, 'wrong')).rejects.toThrow(/401/);
    });

    it('refuses any path but the terminal one', async () => {
        const { port } = await startHarness();
        await expect(connect(port, TOKEN, '/other')).rejects.toThrow(/401/);
    });

    it('runs an encrypted terminal call through the handler', async () => {
        const { port, handleRequest } = await startHarness();
        const socket = await connect(port);
        const reply = nextMessage(socket);
        socket.send(JSON.stringify({ type: 'rpc', id: 7, method: 'terminal-input', params: 'ciphertext' }));

        expect(await reply).toEqual({ type: 'rpc-result', id: 7, result: 'answer:terminal-input:ciphertext' });
        expect(handleRequest).toHaveBeenCalledWith('terminal-input', 'ciphertext');
    });

    it('does not reach methods outside the terminal set', async () => {
        const { port, handleRequest } = await startHarness();
        const socket = await connect(port);
        const reply = nextMessage(socket);
        socket.send(JSON.stringify({ type: 'rpc', id: 1, method: 'spawn-happy-session', params: 'ciphertext' }));

        expect(await reply).toMatchObject({ type: 'rpc-result', id: 1, error: expect.any(String) });
        expect(handleRequest).not.toHaveBeenCalled();
    });

    it('does not pass plaintext params on', async () => {
        const { port, handleRequest } = await startHarness();
        const socket = await connect(port);
        const reply = nextMessage(socket);
        socket.send(JSON.stringify({ type: 'rpc', id: 2, method: 'terminal-list', params: {} }));

        expect(await reply).toMatchObject({ type: 'rpc-result', id: 2, error: expect.any(String) });
        expect(handleRequest).not.toHaveBeenCalled();
    });

    it('forwards frames only for subscribed terminals, until unsubscribed', async () => {
        const { port, pushFrame } = await startHarness();
        const socket = await connect(port);
        const received: LocalTerminalServerMessage[] = [];
        socket.on('message', (data) => received.push(JSON.parse(data.toString())));

        socket.send(JSON.stringify({ type: 'subscribe', terminalId: 'a' }));
        // Round trip an rpc so the subscribe has been handled before frames go out.
        socket.send(JSON.stringify({ type: 'rpc', id: 1, method: 'terminal-list', params: 'x' }));
        await vi.waitFor(() => expect(received).toHaveLength(1));

        pushFrame({ terminalId: 'b', revision: 1, payload: 'other' });
        pushFrame({ terminalId: 'a', revision: 3, payload: 'mine' });
        await vi.waitFor(() => expect(received).toHaveLength(2));
        expect(received[1]).toEqual({ type: 'frame', frame: { terminalId: 'a', revision: 3, payload: 'mine' } });

        socket.send(JSON.stringify({ type: 'unsubscribe', terminalId: 'a' }));
        socket.send(JSON.stringify({ type: 'rpc', id: 2, method: 'terminal-list', params: 'x' }));
        await vi.waitFor(() => expect(received).toHaveLength(3));
        pushFrame({ terminalId: 'a', revision: 4, payload: 'late' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(received).toHaveLength(3);
    });
});

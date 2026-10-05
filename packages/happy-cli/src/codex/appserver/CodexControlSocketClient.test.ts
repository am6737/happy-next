import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { CodexControlSocketClient, codexControlSocketPath } from './CodexControlSocketClient';

describe('CodexControlSocketClient', () => {
    let home = '';
    let server: Server | null = null;
    afterEach(async () => {
        await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
        server = null;
        if (home) rmSync(home, { recursive: true, force: true });
    });

    async function startDaemon(onMessage: (message: any, reply: (data: unknown) => void) => void): Promise<string> {
        home = mkdtempSync(join(tmpdir(), 'happy-codex-control-'));
        const socketPath = join(home, 'daemon.sock');
        server = createServer();
        const wss = new WebSocketServer({ server });
        wss.on('connection', socket => socket.on('message', data =>
            onMessage(JSON.parse(data.toString()), reply => socket.send(JSON.stringify(reply)))));
        await new Promise<void>(resolve => server!.listen(socketPath, resolve));
        // Codex links the control socket from CODEX_HOME to its runtime directory.
        mkdirSync(join(home, 'app-server-control'));
        symlinkSync(socketPath, join(home, 'app-server-control', 'app-server-control.sock'));
        return socketPath;
    }

    it('finds the daemon socket through the Codex home symlink, ignoring a dangling link', async () => {
        const socketPath = await startDaemon(() => {});
        expect(codexControlSocketPath(home)).toBe(join(home, 'app-server-control', 'app-server-control.sock'));
        await new Promise<void>(resolve => server!.close(() => resolve()));
        server = null;
        rmSync(socketPath, { force: true });
        expect(codexControlSocketPath(home)).toBeNull();
    });

    it('correlates responses and surfaces JSON-RPC errors', async () => {
        const socketPath = await startDaemon((message, reply) => {
            if (message.method === 'thread/archive') reply({ id: message.id, error: { code: -32600, message: 'no rollout found' } });
            else reply({ id: message.id, result: { echoed: message.params } });
        });
        const client = await CodexControlSocketClient.connect(socketPath, { timeoutMs: 2_000 });
        await expect(client.request('thread/list', { archived: true })).resolves.toEqual({ echoed: { archived: true } });
        await expect(client.request('thread/archive', { threadId: 't' })).rejects.toThrow(/no rollout found/);
        await client.close();
    });

    it('rejects when nothing listens on the socket', async () => {
        home = mkdtempSync(join(tmpdir(), 'happy-codex-control-'));
        await expect(CodexControlSocketClient.connect(join(home, 'missing.sock'), { timeoutMs: 1_000 })).rejects.toThrow();
    });
});

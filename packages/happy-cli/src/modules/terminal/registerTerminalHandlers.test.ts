import { afterEach, describe, expect, it } from 'vitest';
import { Terminal, type Terminal as HeadlessTerminalInstance } from '@xterm/headless';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { decodeBase64, decrypt } from '@/api/encryption';
import { registerTerminalHandlers } from './registerTerminalHandlers';
import type { TerminalManager } from './terminalManager';
import type { TerminalFrameBody, TerminalState } from 'happy-wire';

const KEY = new Uint8Array(32).fill(7);

interface Frame {
    terminalId: string;
    revision: number;
    payload: string;
}

interface Harness {
    manager: TerminalManager;
    call: (method: string, params?: unknown) => Promise<unknown>;
    frames: Frame[];
    /** The frame at `index`, decrypted — i.e. what the client would receive. */
    body: (index: number) => TerminalFrameBody;
    framesFor: (terminalId: string) => Frame[];
}

const harnesses: Harness[] = [];

function createHarness(): Harness {
    const handlers = new Map<string, (params: any) => unknown>();
    const frames: Frame[] = [];

    const rpc = {
        registerHandler: (method: string, handler: (params: any) => unknown) => {
            handlers.set(method, handler);
        },
    } as unknown as RpcHandlerManager;

    const manager = registerTerminalHandlers(rpc, {
        machineId: 'm1',
        encryptionKey: KEY,
        encryptionVariant: 'legacy',
        sendFrame: (frame) => frames.push(frame),
        // These are about the terminal itself, so they take the plain PTY: a
        // tmux attach client reports its own exit status rather than the
        // shell's, which would make the exit-code assertions meaningless.
        durable: false,
    });

    const harness: Harness = {
        manager,
        frames,
        call: async (method, params) => {
            const handler = handlers.get(method);
            if (!handler) {
                throw new Error(`No handler registered for ${method}`);
            }
            return await handler(params);
        },
        body: (index) => decrypt(KEY, 'legacy', decodeBase64(frames[index]!.payload)) as TerminalFrameBody,
        framesFor: (terminalId) => frames.filter((frame) => frame.terminalId === terminalId),
    };
    harnesses.push(harness);
    return harness;
}

/** Waits for a frame on `terminalId` whose decrypted body satisfies `match`. */
async function waitForBody(
    harness: Harness,
    terminalId: string,
    match: (body: TerminalFrameBody) => boolean,
    timeoutMs = 8000,
): Promise<TerminalFrameBody> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const frame of harness.framesFor(terminalId)) {
            const body = decrypt(KEY, 'legacy', decodeBase64(frame.payload)) as TerminalFrameBody;
            if (match(body)) {
                return body;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No matching frame for ${terminalId}`);
}

/** Reads a raw xterm's visible screen as text, the way a client would draw it. */
function gridText(terminal: HeadlessTerminalInstance): string {
    const buffer = terminal.buffer.active;
    const rows: string[] = [];
    for (let row = 0; row < terminal.rows; row += 1) {
        const line = buffer.getLine(buffer.baseY + row);
        let text = '';
        for (let col = 0; col < terminal.cols; col += 1) {
            text += line?.getCell(col)?.getChars() || ' ';
        }
        rows.push(text.trimEnd());
    }
    return rows.join('\n');
}

async function spawn(harness: Harness, id: string): Promise<string> {
    const info = (await harness.call('terminal-spawn', {
        id,
        cwd: process.cwd(),
        shell: '/bin/bash',
        args: ['--norc', '--noprofile'],
        rows: 24,
        cols: 80,
    })) as { id: string };
    return info.id;
}

afterEach(() => {
    for (const harness of harnesses) {
        harness.manager.stop();
    }
    harnesses.length = 0;
});

describe('registerTerminalHandlers', () => {
    it('honours a caller-supplied terminal id', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'my-terminal');
        expect(id).toBe('my-terminal');
    }, 30000);

    it('pushes a replayable screen on attach, and reports the revision it was sent at', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'attach-1');

        await waitForBody(harness, id, (body) => body.type === 'output');

        const result = (await harness.call('terminal-attach', { terminalId: id })) as { revision: number };
        const snapshot = harness.body(harness.framesFor(id).length - 1);

        expect(snapshot.type).toBe('snapshot');
        // The revision reported to the client matches the frame it was sent in,
        // so a client seeing a later frame first knows it missed the snapshot.
        expect(result.revision).toBe(harness.frames[harness.frames.length - 1]!.revision);

        // The snapshot is only useful if a client can replay it into a fresh
        // emulator — that round trip is the whole point of sending ANSI over a
        // grid, so assert on the screen it produces rather than on the string.
        const { ansi } = snapshot as { ansi: string };
        const restored = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
        await new Promise<void>((resolve) => restored.write(ansi, () => resolve()));
        expect(gridText(restored)).toContain('bash');
        restored.dispose();
    }, 30000);

    it('encrypts every frame so the relay cannot read terminal contents', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'enc-1');
        await harness.call('terminal-input', { terminalId: id, data: "printf 'SECRET_TOKEN_XYZ\\n'\n" });

        await waitForBody(harness, id, (body) => body.type === 'output' && body.data.includes('SECRET_TOKEN_XYZ'));

        // The plaintext must not appear in what goes on the wire.
        const wire = harness.framesFor(id).map((frame) => frame.payload).join('');
        expect(wire).not.toContain('SECRET_TOKEN_XYZ');
    }, 30000);

    it('numbers frames per terminal, in order', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'rev-1');
        await harness.call('terminal-input', { terminalId: id, data: 'echo one\n' });
        await waitForBody(harness, id, (body) => body.type === 'output' && body.data.includes('one'));

        const revisions = harness.framesFor(id).map((frame) => frame.revision);
        expect(revisions.length).toBeGreaterThan(1);
        expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
        expect(new Set(revisions).size).toBe(revisions.length);
    }, 30000);

    it('keeps revisions independent across terminals', async () => {
        const harness = createHarness();
        const first = await spawn(harness, 'multi-a');
        const second = await spawn(harness, 'multi-b');
        await harness.call('terminal-attach', { terminalId: first });
        await harness.call('terminal-attach', { terminalId: second });

        expect(harness.framesFor(first).map((frame) => frame.revision)).toContain(1);
        expect(harness.framesFor(second).map((frame) => frame.revision)).toContain(1);
    }, 30000);

    it('routes input to the terminal it names', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'input-1');

        await harness.call('terminal-input', { terminalId: id, data: "printf 'ROUTED\\n'\n" });
        const body = await waitForBody(harness, id, (b) => b.type === 'output' && b.data.includes('ROUTED'));

        expect(body.type).toBe('output');
    }, 30000);

    it('resizes the pty', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'resize-1');

        await harness.call('terminal-resize', { terminalId: id, rows: 40, cols: 120 });

        const state = (await harness.call('terminal-state', { terminalId: id })) as TerminalState;
        expect(state.rows).toBe(40);
        expect(state.cols).toBe(120);
    }, 30000);

    it('streams an exit frame when the shell terminates', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'exit-1');

        await harness.call('terminal-input', { terminalId: id, data: 'exit 3\n' });
        const body = await waitForBody(harness, id, (b) => b.type === 'exit');

        expect(body.type).toBe('exit');
        expect((body as { exitCode: number | null }).exitCode).toBe(3);
    }, 30000);

    it('lists spawned terminals', async () => {
        const harness = createHarness();
        await spawn(harness, 'list-a');
        await spawn(harness, 'list-b');

        const list = (await harness.call('terminal-list', {})) as Array<{ id: string }>;
        const ids = list.map((entry) => entry.id);
        expect(ids).toContain('list-a');
        expect(ids).toContain('list-b');
    }, 30000);

    it('drops a disposed terminal from the list', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'dispose-1');

        await harness.call('terminal-dispose', { terminalId: id });

        const list = (await harness.call('terminal-list', {})) as Array<{ id: string }>;
        expect(list.map((entry) => entry.id)).not.toContain(id);
    }, 30000);

    it('stops the pty on close but keeps the session readable', async () => {
        const harness = createHarness();
        const id = await spawn(harness, 'close-1');

        await harness.call('terminal-close', { terminalId: id });

        // The kill is signalled synchronously but the process reports its exit
        // asynchronously, so poll rather than assuming it already landed.
        const deadline = Date.now() + 8000;
        let exited = false;
        while (Date.now() < deadline && !exited) {
            const list = (await harness.call('terminal-list', {})) as Array<{ id: string; exited: boolean }>;
            exited = list.find((entry) => entry.id === id)?.exited === true;
            if (!exited) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        expect(exited).toBe(true);
        // Closing stops the process but must not forget the session — the final
        // screen stays available for a client that reattaches.
        const list = (await harness.call('terminal-list', {})) as Array<{ id: string }>;
        expect(list.map((entry) => entry.id)).toContain(id);
    }, 30000);
});

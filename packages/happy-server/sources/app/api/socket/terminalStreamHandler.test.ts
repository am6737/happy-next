import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/presence/sessionCache', () => ({
    activityCache: { isMachineValid: vi.fn() },
}));

import { terminalStreamHandler } from './terminalStreamHandler';
import { activityCache } from '@/app/presence/sessionCache';
import type { ClientConnection } from '@/app/events/eventRouter';

type Handlers = Map<string, (...args: any[]) => unknown>;

interface FakeSocket {
    socket: Socket;
    handlers: Handlers;
    emitted: Array<{ event: string; payload: unknown }>;
    connected: boolean;
}

const created: FakeSocket[] = [];

function createSocket(id: string): FakeSocket {
    const handlers: Handlers = new Map();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const fake: FakeSocket = {
        handlers,
        emitted,
        connected: true,
        socket: {
            id,
            get connected() {
                return fake.connected;
            },
            on: (name: string, handler: (...args: any[]) => unknown) => {
                handlers.set(name, handler);
            },
            emit: (event: string, payload: unknown) => {
                emitted.push({ event, payload });
            },
        } as unknown as Socket,
    };
    created.push(fake);
    return fake;
}

/** Registers a user-scoped client socket and returns its handler map. */
function registerClient(userId = 'owner'): FakeSocket {
    const fake = createSocket('client');
    const connection: ClientConnection = { connectionType: 'user-scoped', socket: fake.socket, userId };
    terminalStreamHandler(userId, fake.socket, connection);
    return fake;
}

/** Registers a machine-scoped daemon socket and returns its handler map. */
function registerDaemon(machineId: string): FakeSocket {
    const fake = createSocket('daemon');
    const connection: ClientConnection = {
        connectionType: 'machine-scoped',
        socket: fake.socket,
        userId: 'owner',
        machineId,
    };
    terminalStreamHandler('owner', fake.socket, connection);
    return fake;
}

async function subscribe(fake: FakeSocket, machineId: string, terminalId: string): Promise<void> {
    await fake.handlers.get('terminal-subscribe')!({ machineId, terminalId }, vi.fn());
}

/** Fires the disconnect handler so module-level subscriptions do not leak. */
function disconnect(fake: FakeSocket): void {
    fake.handlers.get('disconnect')?.();
    fake.connected = false;
}

afterEach(() => {
    for (const fake of created) {
        fake.handlers.get('disconnect')?.();
    }
    created.length = 0;
    vi.mocked(activityCache.isMachineValid).mockReset();
});

describe('terminal-subscribe', () => {
    it('rejects a subscriber who does not own the machine', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(false);

        const client = registerClient('outsider');
        const callback = vi.fn();
        await client.handlers.get('terminal-subscribe')!({ machineId: 'm1', terminalId: 't1' }, callback);

        expect(callback).toHaveBeenCalledWith({ ok: false, error: 'Forbidden' });
    });

    it('rejects malformed requests without touching the access check', async () => {
        const client = registerClient();
        const callback = vi.fn();
        await client.handlers.get('terminal-subscribe')!({ machineId: 'm1' }, callback);

        expect(callback).toHaveBeenCalledWith({ ok: false, error: 'Invalid parameters' });
        expect(activityCache.isMachineValid).not.toHaveBeenCalled();
    });

    it('accepts an owner and then relays the daemon’s frames', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const client = registerClient();
        const callback = vi.fn();
        await client.handlers.get('terminal-subscribe')!({ machineId: 'm1', terminalId: 't1' }, callback);
        expect(callback).toHaveBeenCalledWith({ ok: true });

        const daemon = registerDaemon('m1');
        daemon.handlers.get('terminal-frame')!({ machineId: 'm1', terminalId: 't1', revision: 7, payload: 'ciphertext' });

        expect(client.emitted).toEqual([
            {
                event: 'terminal-frame',
                payload: { machineId: 'm1', terminalId: 't1', revision: 7, payload: 'ciphertext' },
            },
        ]);
    });
});

describe('terminal-frame', () => {
    it('ignores frames from a socket that is not the machine daemon', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        // A user-scoped client injecting output into its own stream.
        const client = registerClient();
        await subscribe(client, 'm2', 't2');
        client.handlers.get('terminal-frame')!({ machineId: 'm2', terminalId: 't2', revision: 1, payload: 'forged' });

        expect(client.emitted).toEqual([]);
    });

    it('does not leak one machine’s output into another machine’s subscriber', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const clientA = registerClient();
        await subscribe(clientA, 'm3', 't3');

        // Daemon B claims machineId m3 in the payload but is connected as m4.
        const daemonB = registerDaemon('m4');
        daemonB.handlers.get('terminal-frame')!({ machineId: 'm3', terminalId: 't3', revision: 1, payload: 'from-b' });

        expect(clientA.emitted).toEqual([]);
    });

    it('drops frames for terminals nobody is watching', () => {
        const daemon = registerDaemon('m5');

        expect(() =>
            daemon.handlers.get('terminal-frame')!({ machineId: 'm5', terminalId: 'unwatched', revision: 1, payload: 'x' }),
        ).not.toThrow();
    });

    it('ignores malformed frames', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const client = registerClient();
        await subscribe(client, 'm6', 't6');
        const daemon = registerDaemon('m6');

        daemon.handlers.get('terminal-frame')!({ machineId: 'm6', terminalId: 't6', revision: 'NaN', payload: 'x' });
        daemon.handlers.get('terminal-frame')!({ machineId: 'm6', terminalId: 't6', revision: 1 });
        daemon.handlers.get('terminal-frame')!({ machineId: 'm6', revision: 1, payload: 'x' });

        expect(client.emitted).toEqual([]);
    });

    it('carries an opaque payload the server never inspects', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const client = registerClient();
        await subscribe(client, 'm7', 't7');
        const daemon = registerDaemon('m7');

        // Any string passes through untouched — the relay must not require the
        // payload to be valid JSON or base64.
        const opaque = 'not-json-=-binary-ish-\x00\x1b[31m';
        daemon.handlers.get('terminal-frame')!({ machineId: 'm7', terminalId: 't7', revision: 3, payload: opaque });

        expect((client.emitted[0]!.payload as { payload: string }).payload).toBe(opaque);
    });
});

describe('terminal-unsubscribe and disconnect', () => {
    it('stops delivering after unsubscribe', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const client = registerClient();
        await subscribe(client, 'm8', 't8');
        const daemon = registerDaemon('m8');

        daemon.handlers.get('terminal-frame')!({ machineId: 'm8', terminalId: 't8', revision: 1, payload: 'before' });
        client.handlers.get('terminal-unsubscribe')!({ machineId: 'm8', terminalId: 't8' });
        daemon.handlers.get('terminal-frame')!({ machineId: 'm8', terminalId: 't8', revision: 2, payload: 'after' });

        expect(client.emitted).toHaveLength(1);
        expect((client.emitted[0]!.payload as { payload: string }).payload).toBe('before');
    });

    it('stops delivering once the subscriber disconnects', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const client = registerClient();
        await subscribe(client, 'm9', 't9');
        const daemon = registerDaemon('m9');

        disconnect(client);
        daemon.handlers.get('terminal-frame')!({ machineId: 'm9', terminalId: 't9', revision: 1, payload: 'after-leave' });

        expect(client.emitted).toEqual([]);
    });

    it('skips a subscriber socket that is no longer connected', async () => {
        vi.mocked(activityCache.isMachineValid).mockResolvedValue(true);

        const live = registerClient();
        const dead = registerClient();
        await subscribe(live, 'm10', 't10');
        await subscribe(dead, 'm10', 't10');

        // The dead socket drops without its disconnect handler having run yet.
        dead.connected = false;

        const daemon = registerDaemon('m10');
        daemon.handlers.get('terminal-frame')!({ machineId: 'm10', terminalId: 't10', revision: 1, payload: 'x' });

        expect(live.emitted).toHaveLength(1);
        expect(dead.emitted).toEqual([]);
    });
});

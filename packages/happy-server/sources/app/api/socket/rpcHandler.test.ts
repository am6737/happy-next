import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/share/accessControl', () => ({ checkSessionAccess: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: {
    session: { findUnique: vi.fn().mockResolvedValue({ accountId: 'owner' }) },
    machine: { findFirst: vi.fn(async ({ where }: any) => where.id === 'machine-1'
        && where.accountId === 'owner' ? { id: 'machine-1' } : null) },
} }));
vi.mock('./rpcRegistry', () => ({ getOrCreateUserRpcListeners: vi.fn(),
    registerUserRpcSocket: vi.fn(), unregisterUserRpcSocket: vi.fn(),
    assertUserRpcSocketOwner: vi.fn(), invokeUserRpc: vi.fn(async () => {
        throw new Error('RPC method not available');
    }) }));
vi.mock('@/app/presence/sessionTurnRuntime', () => ({ updateThinkingState: vi.fn(() => ({ turnEnded: false })) }));
vi.mock('@/app/session/pendingMessageAutoDispatch', () => ({ dispatchNextPendingIfPossible: vi.fn() }));
import { rpcHandler } from './rpcHandler';
import { checkSessionAccess } from '@/app/share/accessControl';
import { getOrCreateUserRpcListeners } from './rpcRegistry';

describe('machine RPC registration identity', () => {
    const method = 'machine-1:orchestrator-dispatch';
    function connectedSocket() {
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const emitted: Array<{ name: string; data: any }> = [];
        const socket = { id: Math.random().toString(), connected: true,
            on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler),
            emit: (name: string, data: any) => emitted.push({ name, data }),
        } as unknown as Socket;
        return { socket, handlers, emitted };
    }
    it('rejects user and mismatched machine sockets without replacing the owner', async () => {
        const listeners = new Map<string, Socket>();
        const owner = connectedSocket();
        rpcHandler('owner', owner.socket, listeners, { connectionType: 'machine-scoped',
            socket: owner.socket, userId: 'owner', machineId: 'machine-1' });
        await owner.handlers.get('rpc-register')!({ method });
        expect(listeners.get(method)).toBe(owner.socket);
        const user = connectedSocket();
        rpcHandler('owner', user.socket, listeners, { connectionType: 'user-scoped',
            socket: user.socket, userId: 'owner' });
        await user.handlers.get('rpc-register')!({ method });
        expect(user.emitted.at(-1)?.name).toBe('rpc-error');
        const otherMachine = connectedSocket();
        rpcHandler('owner', otherMachine.socket, listeners, { connectionType: 'machine-scoped',
            socket: otherMachine.socket, userId: 'owner', machineId: 'machine-2' });
        await otherMachine.handlers.get('rpc-register')!({ method });
        expect(otherMachine.emitted.at(-1)?.name).toBe('rpc-error');
        expect(listeners.get(method)).toBe(owner.socket);
    });
    it('keeps the newer machine registration when the old socket unregisters', async () => {
        const listeners = new Map<string, Socket>();
        const oldSocket = connectedSocket();
        const newSocket = connectedSocket();
        for (const target of [oldSocket, newSocket]) {
            rpcHandler('owner', target.socket, listeners, { connectionType: 'machine-scoped',
                socket: target.socket, userId: 'owner', machineId: 'machine-1' });
            await target.handlers.get('rpc-register')!({ method });
        }
        await oldSocket.handlers.get('rpc-unregister')!({ method });
        expect(listeners.get(method)).toBe(newSocket.socket);
    });
});

describe('RPC native history timeouts', () => {
    it.each([
        ['machine:codex-archive-session', 110000],
        ['machine:codex-fork-session', 110000],
        ['machine:codex-duplicate-session', 110000],
        ['session:killSession', 30000],
        ['machine:claude-fork-session', 30000],
        ['session:openFilePreview', 60000],
        ['session:readFilePreviewChunk', 30000],
        ['session:openFileDownload', 60000],
        ['session:readFileDownloadChunk', 30000],
        ['session:closeFileDownload', 30000],
    ])('uses the scoped timeout for %s', async (method, timeout) => {
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const socket = { on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler) } as unknown as Socket;
        const target = { connected: true, timeout: vi.fn().mockReturnThis(), emitWithAck: vi.fn().mockResolvedValue('encrypted-result') };
        rpcHandler('owner', socket, new Map([[method, target as unknown as Socket]]));
        const callback = vi.fn();
        await handlers.get('rpc-call')!({ method, params: 'encrypted-params' }, callback);
        expect(target.timeout).toHaveBeenCalledWith(timeout);
        expect(target.emitWithAck).toHaveBeenCalledWith('rpc-request', { method, params: 'encrypted-params' });
        expect(callback).toHaveBeenCalledWith({ ok: true, result: 'encrypted-result' });
    });
});

describe('shared-session preview permissions', () => {
    it('rejects download requests without session access', async () => {
        vi.mocked(checkSessionAccess).mockResolvedValue(null);
        vi.mocked(getOrCreateUserRpcListeners).mockClear();
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const socket = { on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler) } as unknown as Socket;
        rpcHandler('outsider', socket, new Map());
        const callback = vi.fn();
        await handlers.get('rpc-call')!({ method: 'shared-session:openFileDownload', params: 'encrypted' }, callback);
        expect(callback).toHaveBeenCalledWith({ ok: false, error: 'RPC method not available' });
        expect(getOrCreateUserRpcListeners).not.toHaveBeenCalled();
    });
    it.each([
        ['view', 'openFilePreview', true],
        ['view', 'readFilePreviewChunk', true],
        ['view', 'closeFilePreview', true],
        ['view', 'openFileDownload', true],
        ['view', 'readFileDownloadChunk', true],
        ['view', 'closeFileDownload', true],
        ['edit', 'openFileDownload', true],
        ['admin', 'openFileDownload', true],
        ['edit', 'openFilePreview', true],
        ['admin', 'openFilePreview', true],
        ['view', 'writeFile', false],
        ['view', 'bash', false],
        ['edit', 'bash', false],
        ['view', 'unknownMethod', false],
    ] as const)('%s access to %s: %s', async (level, rpcMethod, allowed) => {
        vi.mocked(checkSessionAccess).mockResolvedValue({ level, isOwner: false } as Awaited<ReturnType<typeof checkSessionAccess>>);
        const method = `shared-session:${rpcMethod}`;
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const socket = { on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler) } as unknown as Socket;
        const target = { connected: true, timeout: vi.fn().mockReturnThis(), emitWithAck: vi.fn().mockResolvedValue('encrypted-result') };
        vi.mocked(getOrCreateUserRpcListeners).mockReturnValue(new Map([[method, target as unknown as Socket]]));
        rpcHandler('viewer', socket, new Map());
        const callback = vi.fn();
        await handlers.get('rpc-call')!({ method, params: 'encrypted-params' }, callback);
        expect(callback).toHaveBeenCalledWith(allowed ? { ok: true, result: 'encrypted-result' } : { ok: false, error: 'Forbidden' });
        expect(target.emitWithAck).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });
});

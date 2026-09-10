import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/share/accessControl', () => ({ checkSessionAccess: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: { session: { findUnique: vi.fn().mockResolvedValue({ accountId: 'owner' }) } } }));
vi.mock('./rpcRegistry', () => ({ getOrCreateUserRpcListeners: vi.fn() }));
vi.mock('@/app/presence/sessionTurnRuntime', () => ({ updateThinkingState: vi.fn(() => ({ turnEnded: false })) }));
vi.mock('@/app/session/pendingMessageAutoDispatch', () => ({ dispatchNextPendingIfPossible: vi.fn() }));
import { rpcHandler } from './rpcHandler';
import { checkSessionAccess } from '@/app/share/accessControl';
import { getOrCreateUserRpcListeners } from './rpcRegistry';

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

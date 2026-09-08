import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/share/accessControl', () => ({ checkSessionAccess: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: {} }));
vi.mock('@/app/presence/sessionTurnRuntime', () => ({ updateThinkingState: vi.fn(() => ({ turnEnded: false })) }));
vi.mock('@/app/session/pendingMessageAutoDispatch', () => ({ dispatchNextPendingIfPossible: vi.fn() }));
import { rpcHandler } from './rpcHandler';

describe('RPC native history timeouts', () => {
    it.each([
        ['machine:codex-archive-session', 110000],
        ['machine:codex-fork-session', 110000],
        ['machine:codex-duplicate-session', 110000],
        ['session:killSession', 30000],
        ['machine:claude-fork-session', 30000],
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

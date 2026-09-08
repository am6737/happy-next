import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getState: vi.fn(), sessionRPC: vi.fn(), machineRPC: vi.fn(), request: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: mocks }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: { getState: mocks.getState } }));
import { sessionArchive, sessionKill, machineForkCodexSession, machineDuplicateCodexSession } from './ops';

describe('stop-based archive with Codex native synchronization', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getState.mockReturnValue({ sessions: { s1: { metadata: { flavor: 'codex', machineId: 'm1', codexSessionId: 'native-1' } } } });
        mocks.sessionRPC.mockResolvedValue({ success: true });
        mocks.machineRPC.mockResolvedValue({ success: true });
    });

    it('stops first, then archives through the machine without a server archive endpoint', async () => {
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.sessionRPC).toHaveBeenCalledWith('s1', 'killSession', {});
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-archive-session', { sessionId: 's1', nativeSessionId: 'native-1' }, 120_000);
        expect(mocks.sessionRPC.mock.invocationCallOrder[0]).toBeLessThan(mocks.machineRPC.mock.invocationCallOrder[0]);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it.each(['claude', 'gemini'])('keeps the existing %s archive behavior', async flavor => {
        mocks.getState.mockReturnValue({ sessions: { s1: { metadata: { flavor } } } });
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('does not add native side effects to ordinary stop operations', async () => {
        await sessionKill('s1');
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('can retry native archive after the session RPC has exited', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.machineRPC).toHaveBeenCalledOnce();
    });

    it('does not archive after an unacknowledged stop failure', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('Disconnected'));
        expect(await sessionArchive('s1')).toEqual({ success: false, message: 'Disconnected' });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('reports native failure separately without rolling back the stop', async () => {
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: true, error: 'native-archive-failed' });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'native-archive-failed' });
    });

    it('does not swallow an unavailable daemon RPC as native success', async () => {
        mocks.machineRPC.mockRejectedValue(new Error('RPC method not available'));
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'RPC method not available' });
    });

    it('reports a missing machine after stopping', async () => {
        mocks.getState.mockReturnValue({ sessions: { s1: { metadata: { flavor: 'codex' } } } });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'machine-id-unavailable' });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('allows native restore to finish within the resume RPC timeout', async () => {
        await machineForkCodexSession('m1', 'native-1');
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-fork-session', { codexSessionId: 'native-1' }, 120000);
    });

    it('passes caller timeouts through to the duplicate RPC', async () => {
        await machineDuplicateCodexSession('m1', 'native-1', 'message-1', { timeoutMs: 45000 });
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-duplicate-session', { codexSessionId: 'native-1', truncateBeforeUuid: 'message-1' }, 45000);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { binding, rpc, running } = vi.hoisted(() => ({
    binding: { sessionId: 'happy-1', provider: 'codex', cwd: '/tmp', pid: 999999,
        identity: 'start S', nativeSessionIds: ['native-1'], processes: [] },
    rpc: { spawn: vi.fn(), request: vi.fn(), notify: vi.fn(), close: vi.fn(), pid: undefined as number | undefined },
    running: vi.fn(),
}));
const home = vi.hoisted(() => ({ value: '' }));
vi.mock('@/configuration', () => ({ configuration: { get happyHomeDir() { return home.value; } } }));
vi.mock('./sessionBinding', () => ({
    readSessionBinding: vi.fn(() => binding), listSessionBindings: vi.fn(() => [binding]),
    isBindingRunning: running, processIdentity: vi.fn(),
    readStopSnapshot: vi.fn(() => []), writeStopSnapshot: vi.fn(),
}));
vi.mock('@/codex/appserver/CodexJsonRpcPeer', () => ({ CodexJsonRpcPeer: vi.fn(() => rpc) }));
import { executeSessionArchive, syncCodexArchive, restoreCodexSession } from './executeSessionArchive';
import { readSessionBinding, listSessionBindings, processIdentity, writeStopSnapshot, type SessionBinding } from './sessionBinding';

describe('executeSessionArchive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        binding.provider = 'codex';
        binding.nativeSessionIds = ['native-1'];
        rpc.pid = undefined;
        running.mockReturnValue(false);
        vi.mocked(readSessionBinding).mockReturnValue(binding as SessionBinding);
        vi.mocked(listSessionBindings).mockReturnValue([binding as SessionBinding]);
        rpc.request.mockResolvedValue({ data: [], nextCursor: null });
    });
    afterEach(() => { if (home.value) rmSync(home.value, { recursive: true, force: true }); });
    it('restores native history after worktree cleanup using a stable cwd and the original Codex home', async () => {
        home.value = mkdtempSync(join(tmpdir(), 'happy-archive-cwd-'));
        const removedCwd = join(home.value, 'deleted-worktree');
        await syncCodexArchive({ ...binding, provider: 'codex', cwd: removedCwd, codexHome: '../codex-data' } as SessionBinding, false);
        expect(rpc.spawn).toHaveBeenCalledWith('npx', expect.any(Array), expect.objectContaining({
            cwd: join(home.value, 'archive-runtime'), env: { CODEX_HOME: join(home.value, 'codex-data') },
        }));
        expect(rpc.request).toHaveBeenCalledWith('thread/unarchive', { threadId: 'native-1' }, 20000);
    });
    it('does not repeat native restore when a successful acknowledgement was lost', async () => {
        rpc.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [{ id: 'native-1' }] });
        await syncCodexArchive(binding as SessionBinding, false);
        expect(rpc.request.mock.calls.some(([method]) => method === 'thread/unarchive')).toBe(false);
    });
    it('records the native helper before sending any native side effects', async () => {
        rpc.pid = 999998;
        vi.mocked(processIdentity).mockReturnValue('helper S');
        await syncCodexArchive(binding as SessionBinding, true);
        expect(writeStopSnapshot).toHaveBeenCalledWith(binding, [{ pid: 999998, identity: 'helper S' }]);
        expect(vi.mocked(writeStopSnapshot).mock.invocationCallOrder[0]).toBeLessThan(rpc.request.mock.invocationCallOrder[0]);
    });
    it('does not report restore success if process verification fails', async () => {
        running.mockImplementation(() => { throw new Error('process-verification-unsupported'); });
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toMatchObject({ error: 'process-verification-unsupported' });
        expect(rpc.spawn).not.toHaveBeenCalled();
    });

    it.each(['claude', 'gemini'] as const)('rejects %s without touching its processes or history', async provider => {
        binding.provider = provider;
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toEqual({ success: false, stopped: false, error: 'session-provider-mismatch' });
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
    it('does not treat missing process identity as success', async () => {
        vi.mocked(readSessionBinding).mockReturnValue(null);
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toMatchObject({ success: false, stopped: false, error: 'session-identity-unavailable' });
        expect(running).not.toHaveBeenCalled();
        expect(writeStopSnapshot).not.toHaveBeenCalled();
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
    it('completes an empty Codex session without a native helper', async () => {
        binding.provider = 'codex';
        binding.nativeSessionIds = [];
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toEqual({ success: true, stopped: true });
        expect(running).toHaveBeenCalled();
        expect(rpc.spawn).not.toHaveBeenCalled();
        expect(rpc.request).not.toHaveBeenCalled();
    });
    it('does not treat a known native thread with missing identity as an empty session', async () => {
        binding.provider = 'codex';
        binding.nativeSessionIds = [];
        expect(await executeSessionArchive({ sessionId: 'happy-1', nativeSessionId: 'native-1' }))
            .toMatchObject({ error: 'native-session-id-unavailable', stopped: false });
        expect(running).not.toHaveBeenCalled();
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
    it('syncs a native thread recorded during shutdown of an initially empty session', async () => {
        binding.provider = 'codex';
        vi.mocked(readSessionBinding).mockReturnValueOnce({ ...binding, nativeSessionIds: [] } as SessionBinding);
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toEqual({ success: true, stopped: true });
        expect(rpc.request).toHaveBeenCalledWith('thread/archive', { threadId: 'native-1' }, 20000);
    });
    it('does not treat IDs lost during shutdown as an empty session', async () => {
        binding.provider = 'codex';
        vi.mocked(readSessionBinding).mockReturnValueOnce(binding as SessionBinding)
            .mockReturnValueOnce({ ...binding, nativeSessionIds: [] } as SessionBinding);
        const result = await executeSessionArchive({ sessionId: 'happy-1' });
        expect(result).toMatchObject({ stopped: true, error: 'native-session-id-unavailable' });
        expect(result.success).toBe(false);
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
    it('refuses a native session used by another live Happy session', async () => {
        vi.mocked(listSessionBindings).mockReturnValue([binding as SessionBinding, { ...binding, sessionId: 'happy-2' } as SessionBinding]);
        running.mockReturnValue(true);
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toMatchObject({ stopped: false, error: 'native-session-in-use' });
    });
    it('does not archive a session restarted while its old wrapper was stopping', async () => {
        const restarted = { ...binding, pid: 999998 } as SessionBinding;
        vi.mocked(readSessionBinding).mockReturnValueOnce(binding as SessionBinding).mockReturnValueOnce(restarted);
        running.mockImplementation(process => process.pid === restarted.pid);
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toMatchObject({ success: false, error: 'native-session-in-use' });
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
    it('archives Codex without starting or resuming a thread', async () => {
        binding.provider = 'codex';
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toEqual({ success: true, stopped: true });
        expect(rpc.request).toHaveBeenCalledWith('thread/archive', { threadId: 'native-1' }, 20000);
        expect(rpc.request.mock.calls.some(([method]) => ['thread/start', 'thread/resume'].includes(method))).toBe(false);
        expect(rpc.close).toHaveBeenCalled();
    });
    it('retains stop success when native archive fails', async () => {
        binding.provider = 'codex';
        rpc.request.mockRejectedValue(new Error('native error with private path'));
        expect(await executeSessionArchive({ sessionId: 'happy-1' }))
            .toEqual({ success: false, stopped: true, error: 'native-archive-failed' });
        expect(rpc.close).toHaveBeenCalled();
    });
    it('skips already archived threads on later list pages', async () => {
        rpc.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [], nextCursor: 'next' })
            .mockResolvedValueOnce({ data: [{ id: 'native-1' }], nextCursor: null });
        await syncCodexArchive(binding as SessionBinding, true);
        expect(rpc.request.mock.calls.some(([method]) => method === 'thread/archive')).toBe(false);
    });
    it('unarchives without starting a new conversation', async () => {
        await syncCodexArchive(binding as SessionBinding, false);
        expect(rpc.request).toHaveBeenCalledWith('thread/unarchive', { threadId: 'native-1' }, 20000);
    });

    it('restores only the requested native thread, without creating a conversation', async () => {
        binding.nativeSessionIds = ['native-1', 'native-2'];
        await restoreCodexSession('native-2');
        expect(rpc.request).toHaveBeenCalledWith('thread/unarchive', { threadId: 'native-2' }, 20000);
        expect(rpc.request.mock.calls.some(([method, params]) => method === 'thread/unarchive' && params.threadId === 'native-1')).toBe(false);
        expect(rpc.request.mock.calls.some(([method]) => ['thread/start', 'thread/resume'].includes(method))).toBe(false);
    });

    it('refuses to restore a thread still in use by a Happy process', async () => {
        running.mockReturnValue(true);
        await expect(restoreCodexSession('native-1')).rejects.toThrow('native-session-in-use');
        expect(rpc.spawn).not.toHaveBeenCalled();
    });

    it('does not restore an unknown thread using an invented binding', async () => {
        await expect(restoreCodexSession('unknown')).rejects.toThrow('session-identity-unavailable');
        expect(rpc.spawn).not.toHaveBeenCalled();
    });
});

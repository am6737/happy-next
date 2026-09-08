import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), restore: vi.fn(), copy: vi.fn() }));
vi.mock('./codexSessionReader', () => ({ findCodexSessionFile: mocks.find, generateStableUuid: vi.fn(), extractUserText: vi.fn(), isSystemMessage: vi.fn() }));
vi.mock('@/daemon/executeSessionArchive', () => ({ restoreCodexSession: mocks.restore }));
vi.mock('node:fs/promises', () => ({ copyFile: mocks.copy, readFile: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
import { forkCodexSession } from './codexSessionFork';

describe('resume an archived Codex session', () => {
    beforeEach(() => { vi.resetAllMocks(); });

    it('keeps the normal fork path free of native restore calls', async () => {
        mocks.find.mockReturnValue('/codex/sessions/original.jsonl');
        expect((await forkCodexSession('native-1')).success).toBe(true);
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(mocks.copy).toHaveBeenCalledOnce();
    });

    it('restores before copying, using the original Codex home', async () => {
        mocks.find.mockReturnValueOnce(null).mockReturnValueOnce('/original-home/sessions/original.jsonl');
        mocks.restore.mockResolvedValue('/original-home');
        const result = await forkCodexSession('native-1');
        expect(result.success).toBe(true);
        expect(mocks.restore).toHaveBeenCalledWith('native-1');
        expect(mocks.find).toHaveBeenLastCalledWith('native-1', '/original-home');
        expect(mocks.restore.mock.invocationCallOrder[0]).toBeLessThan(mocks.copy.mock.invocationCallOrder[0]);
        expect(result.newFilePath).toMatch(/^\/original-home\/sessions\//);
    });

    it('does not create a fork when native restore fails', async () => {
        mocks.find.mockReturnValue(null);
        mocks.restore.mockRejectedValue(new Error('native failure'));
        expect((await forkCodexSession('native-1')).success).toBe(false);
        expect(mocks.copy).not.toHaveBeenCalled();
    });

    it('does not claim success when a restored file is still missing', async () => {
        mocks.find.mockReturnValue(null);
        expect((await forkCodexSession('native-1')).success).toBe(false);
        expect(mocks.copy).not.toHaveBeenCalled();
    });
});

import { describe, expect, it, vi } from 'vitest';
import { FILE_DOWNLOAD_LIMIT, FILE_PREVIEW_CHUNK_SIZE, type OpenFileDownloadResponse } from 'happy-wire';
import { downloadFile, downloadFileName } from './downloadFile';

const request = { path: 'file.bin', repoPath: '/repo', version: 'worktree' as const, compare: false };
function setup(data = Buffer.from([0, 255, 128, 1])) {
    const metadata: OpenFileDownloadResponse = {
        success: true, token: 'token', size: data.length, kind: 'file', mimeType: 'application/octet-stream',
        path: 'file.bin', version: 'worktree', deleted: false, diff: '', diffUnavailable: false, changed: false,
    };
    const rpc = {
        open: vi.fn(async (): Promise<OpenFileDownloadResponse> => metadata),
        chunk: vi.fn(async (_token: string, offset: number) => {
            const end = Math.min(data.length, offset + FILE_PREVIEW_CHUNK_SIZE);
            return { success: true as const, content: data.subarray(offset, end).toString('base64'), nextOffset: end, done: end === data.length };
        }),
        close: vi.fn(async () => ({})),
    };
    const chunks: Uint8Array[] = [];
    const sink = { start: vi.fn(), write: vi.fn((chunk: Uint8Array) => { chunks.push(chunk); }) };
    const progress = vi.fn();
    const controller = new AbortController();
    const run = () => downloadFile(request, rpc, controller.signal, sink, progress);
    return { rpc, sink, progress, controller, chunks, run, metadata };
}

describe('chunked arbitrary file download', () => {
    it('transfers original non-UTF-8 bytes with monotonic progress and releases the token', async () => {
        const data = Buffer.alloc(FILE_PREVIEW_CHUNK_SIZE * 2 + 7, 255);
        data[0] = 0;
        const test = setup(data);
        await test.run();
        expect(Buffer.concat(test.chunks)).toEqual(data);
        expect(test.progress.mock.calls.map(([p]) => p.received)).toEqual([0, FILE_PREVIEW_CHUNK_SIZE, FILE_PREVIEW_CHUNK_SIZE * 2, data.length]);
        expect(test.rpc.close).toHaveBeenCalledExactlyOnceWith('token');
    });
    it('downloads empty files without requesting a chunk', async () => {
        const test = setup(Buffer.alloc(0));
        expect((await test.run()).size).toBe(0);
        expect(test.sink.start).toHaveBeenCalled();
        expect(test.rpc.chunk).not.toHaveBeenCalled();
        expect(test.progress).toHaveBeenCalledWith({ received: 0, total: 0 });
        expect(test.rpc.close).toHaveBeenCalled();
    });
    it.each([FILE_DOWNLOAD_LIMIT + 1, -1, NaN, 1.5])('rejects invalid download size %s before writing', async (size) => {
        const test = setup();
        test.rpc.open.mockResolvedValue({ ...test.metadata, size });
        await expect(test.run()).rejects.toMatchObject({ code: 'too_large' });
        expect(test.sink.start).not.toHaveBeenCalled();
        expect(test.rpc.chunk).not.toHaveBeenCalled();
        expect(test.rpc.close).toHaveBeenCalled();
    });
    it.each([
        { content: '', nextOffset: 0, done: false },
        { content: 'AA==', nextOffset: 4, done: true },
        { content: 'AP+AAQ==', nextOffset: 4, done: false },
        { content: 'AAAAAAA=', nextOffset: 5, done: true },
        { content: '!not base64!', nextOffset: 4, done: true },
        { content: 'A'.repeat(FILE_PREVIEW_CHUNK_SIZE * 2), nextOffset: 4, done: true },
    ])('rejects malformed chunks and releases the snapshot', async (chunk) => {
        const test = setup();
        test.rpc.chunk.mockResolvedValue({ success: true, ...chunk });
        await expect(test.run()).rejects.toThrow();
        expect(test.sink.write).not.toHaveBeenCalled();
        expect(test.rpc.close).toHaveBeenCalled();
    });
    it('does not start an already cancelled transfer', async () => {
        const test = setup();
        test.controller.abort();
        await expect(test.run()).rejects.toThrow('Aborted');
        expect(test.rpc.open).not.toHaveBeenCalled();
    });
    it('cancels immediately while opening and closes the late token', async () => {
        const test = setup();
        let resolve!: (value: OpenFileDownloadResponse) => void;
        test.rpc.open.mockReturnValue(new Promise((done) => { resolve = done; }));
        const result = test.run();
        test.controller.abort();
        await expect(result).rejects.toThrow('Aborted');
        resolve(test.metadata);
        await vi.waitFor(() => expect(test.rpc.close).toHaveBeenCalledExactlyOnceWith('token'));
        expect(test.sink.start).not.toHaveBeenCalled();
    });
    it('cancels an in-flight chunk without exporting late bytes', async () => {
        const test = setup();
        let resolve!: (value: Awaited<ReturnType<typeof test.rpc.chunk>>) => void;
        test.rpc.chunk.mockReturnValue(new Promise((done) => { resolve = done; }));
        const result = test.run();
        await vi.waitFor(() => expect(test.rpc.chunk).toHaveBeenCalled());
        test.controller.abort();
        await expect(result).rejects.toThrow('Aborted');
        resolve({ success: true, content: 'AP+AAQ==', nextOffset: 4, done: true });
        await Promise.resolve();
        expect(test.sink.write).not.toHaveBeenCalled();
        expect(test.rpc.close).toHaveBeenCalledExactlyOnceWith('token');
    });
    it('stops after cancellation between chunks', async () => {
        const test = setup(Buffer.alloc(FILE_PREVIEW_CHUNK_SIZE + 1));
        test.sink.write.mockImplementation(() => test.controller.abort());
        await expect(test.run()).rejects.toThrow('Aborted');
        expect(test.rpc.chunk).toHaveBeenCalledTimes(1);
        expect(test.rpc.close).toHaveBeenCalled();
    });
    it('releases snapshots when the sink or connection fails', async () => {
        for (const failure of ['sink', 'connection']) {
            const test = setup();
            if (failure === 'sink') test.sink.start.mockImplementation(() => { throw new Error('Disk full'); });
            else test.rpc.chunk.mockRejectedValue(new Error('Disconnected'));
            await expect(test.run()).rejects.toThrow();
            expect(test.rpc.close).toHaveBeenCalled();
        }
    });
    it('does not fall back to another API when open fails', async () => {
        const test = setup();
        test.rpc.open.mockResolvedValue({ success: false, code: 'denied', error: 'Denied' });
        await expect(test.run()).rejects.toMatchObject({ code: 'denied' });
        expect(test.rpc.chunk).not.toHaveBeenCalled();
        expect(test.rpc.close).not.toHaveBeenCalled();
    });
    it('keeps Unicode filenames while removing path separators and control characters', () => {
        expect(downloadFileName('/repo/中文.zip')).toBe('中文.zip');
        expect(downloadFileName('..\\file\n.zip')).toBe('file_.zip');
        expect(downloadFileName('..')).toBe('_');
        expect(downloadFileName('/')).toBe('download');
    });
});

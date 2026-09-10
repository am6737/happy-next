import { describe, expect, it, vi } from 'vitest';
import {
    FILE_PREVIEW_TEXT_LIMIT,
    getFilePreviewType,
    type OpenFilePreviewResponse,
} from 'happy-wire';
import { loadFilePreview, selectPreviewMode } from './loadFilePreview';

const request = {
    path: 'readme.md',
    repoPath: '/repo',
    version: 'worktree' as const,
    compare: false,
};
function rpcFor(content: string) {
    const data = Buffer.from(content);
    const metadata: OpenFilePreviewResponse = {
        success: true,
        token: 'token',
        size: data.length,
        kind: 'markdown',
        mimeType: 'text/markdown',
        version: 'worktree',
        deleted: false,
        path: 'readme.md',
        diff: '',
        diffUnavailable: false,
        changed: false,
    };
    return {
        open: vi.fn(async () => metadata),
        chunk: vi.fn(async () => ({
            success: true as const,
            content: data.toString('base64'),
            nextOffset: data.length,
            done: true,
        })),
        close: vi.fn(async () => ({})),
    };
}
describe('file preview loading', () => {
    it('loads UTF-8 source and always releases the snapshot', async () => {
        const rpc = rpcFor('# 中文');
        const result = await loadFilePreview(
            request,
            rpc,
            new AbortController().signal
        );
        expect(result.text).toBe('# 中文');
        expect(rpc.close).toHaveBeenCalledWith('token');
    });
    it('accepts an empty file without requesting a chunk', async () => {
        const rpc = rpcFor('');
        expect(
            (await loadFilePreview(request, rpc, new AbortController().signal))
                .text
        ).toBe('');
        expect(rpc.chunk).not.toHaveBeenCalled();
        expect(rpc.close).toHaveBeenCalled();
    });
    it('rejects oversized metadata before allocating or transferring', async () => {
        const rpc = rpcFor('');
        const meta = await rpc.open();
        rpc.open.mockResolvedValue({
            ...meta,
            size: FILE_PREVIEW_TEXT_LIMIT + 1,
        });
        await expect(
            loadFilePreview(request, rpc, new AbortController().signal)
        ).rejects.toMatchObject({ code: 'too_large' });
        expect(rpc.chunk).not.toHaveBeenCalled();
        expect(rpc.close).toHaveBeenCalled();
    });
    it('rejects malformed chunks and frees resources', async () => {
        const rpc = rpcFor('data');
        rpc.chunk.mockResolvedValue({
            success: true,
            content: 'YQ==',
            nextOffset: 0,
            done: true,
        });
        await expect(
            loadFilePreview(request, rpc, new AbortController().signal)
        ).rejects.toMatchObject({ code: 'unavailable' });
        expect(rpc.close).toHaveBeenCalled();
    });
    it('cancels obsolete reads without leaking a snapshot', async () => {
        const rpc = rpcFor('data');
        const controller = new AbortController();
        controller.abort();
        await expect(
            loadFilePreview(request, rpc, controller.signal)
        ).rejects.toThrow('Aborted');
        expect(rpc.chunk).not.toHaveBeenCalled();
        expect(rpc.close).toHaveBeenCalled();
    });
    it('recognizes preview types without treating filenames as extensions', () => {
        for (const path of [
            'a.SVG',
            'a.html',
            'a.HTM',
            'a.md',
            'a.markdown',
            'a.pdf',
            'a.png',
        ])
            expect(getFilePreviewType(path)).not.toBeNull();
        expect(getFilePreviewType('svg')).toBeNull();
        expect(getFilePreviewType('a.zip')).toBeNull();
    });
    it('selects preview for browsing and diff for changed text, but never binary diff', () => {
        expect(selectPreviewMode(undefined, true, true, false)).toBe('preview');
        expect(selectPreviewMode('diff', true, true, true)).toBe('diff');
        expect(selectPreviewMode('file', true, true, true)).toBe('file');
        expect(selectPreviewMode('preview', true, true, true)).toBe('preview');
        expect(selectPreviewMode('diff', false, false, true)).toBe('preview');
    });
});

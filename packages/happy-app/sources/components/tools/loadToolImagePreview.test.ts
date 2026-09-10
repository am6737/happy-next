import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiSocket } from '@/sync/apiSocket';
import { loadToolImagePreview, ToolImagePreviewError } from './loadToolImagePreview';

vi.mock('@/sync/apiSocket', () => ({ apiSocket: { sessionRPC: vi.fn() } }));
const rpc = vi.mocked(apiSocket.sessionRPC);

beforeEach(() => rpc.mockReset());

function mockImage() {
    rpc.mockResolvedValueOnce({ success: true, kind: 'image', mimeType: 'image/png', size: 3, token: 'token' });
    rpc.mockResolvedValueOnce({ success: true, content: 'YWJj', nextOffset: 3, done: true });
    rpc.mockResolvedValueOnce({ success: true });
}

describe('loadToolImagePreview', () => {
    it('requests only a call ID and closes the token after loading', async () => {
        mockImage();
        expect(await loadToolImagePreview('session', 'call', new AbortController().signal)).toBe('data:image/png;base64,YWJj');
        expect(rpc.mock.calls).toEqual([
            ['session', 'openToolImagePreview', { callId: 'call' }],
            ['session', 'readToolImagePreviewChunk', { token: 'token', offset: 0 }],
            ['session', 'closeToolImagePreview', { token: 'token', offset: 0 }],
        ]);
    });

    it.each(['image_not_registered', 'image_missing', 'image_changed', 'image_unsupported'])('preserves the specific error %s', async (error) => {
        rpc.mockResolvedValueOnce({ success: false, code: 'unavailable', error });
        await expect(loadToolImagePreview('session', 'call', new AbortController().signal)).rejects.toEqual(new ToolImagePreviewError(error));
    });

    it('closes the snapshot when unmounted during opening', async () => {
        const controller = new AbortController();
        rpc.mockImplementationOnce(async () => {
            controller.abort();
            return { success: true, kind: 'image', mimeType: 'image/png', size: 3, token: 'token' };
        });
        rpc.mockResolvedValueOnce({ success: true });
        await expect(loadToolImagePreview('session', 'call', controller.signal)).rejects.toThrow('Aborted');
        expect(rpc).toHaveBeenLastCalledWith('session', 'closeToolImagePreview', { token: 'token', offset: 0 });
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('closes the snapshot after a chunk failure and allows retry', async () => {
        rpc.mockResolvedValueOnce({ success: true, kind: 'image', mimeType: 'image/png', size: 3, token: 'token' });
        rpc.mockRejectedValueOnce(new Error('offline'));
        rpc.mockResolvedValueOnce({ success: true });
        await expect(loadToolImagePreview('session', 'call', new AbortController().signal)).rejects.toThrow('offline');
        expect(rpc).toHaveBeenLastCalledWith('session', 'closeToolImagePreview', { token: 'token', offset: 0 });
        mockImage();
        expect(await loadToolImagePreview('session', 'call', new AbortController().signal)).toContain('data:image/png');
    });
});

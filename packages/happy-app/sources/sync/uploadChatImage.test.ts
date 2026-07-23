import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));

import { uploadChatImage } from './uploadChatImage';

const image = {
    uri: 'blob:local-image',
    width: 100,
    height: 80,
    mimeType: 'image/png',
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('uploadChatImage', () => {
    it('returns uploaded image metadata', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ blob: async () => new Blob(['image'], { type: 'image/png' }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        url: 'https://cdn.example.com/image.png',
                        width: 100,
                        height: 80,
                        mimeType: 'image/png',
                        thumbhash: 'hash',
                    },
                }),
            });
        vi.stubGlobal('fetch', fetchMock);

        await expect(uploadChatImage('session-1', image, 'token', 'https://api.example.com'))
            .resolves.toMatchObject({ url: 'https://cdn.example.com/image.png', width: 100, height: 80 });
        expect(fetchMock).toHaveBeenLastCalledWith(
            'https://api.example.com/v1/chat/upload-image',
            expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        );
    });

    it('reports an HTTP upload failure', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ blob: async () => new Blob(['image'], { type: 'image/png' }) })
            .mockResolvedValueOnce({ ok: false, status: 503 }));

        await expect(uploadChatImage('session-1', image, 'token', 'https://api.example.com'))
            .rejects.toThrow('Upload failed: 503');
    });
});

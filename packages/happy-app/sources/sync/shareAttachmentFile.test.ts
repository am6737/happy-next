import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentContent } from './typesRaw';

const mocks = vi.hoisted(() => ({
    files: [] as Array<{ write: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }>,
    shareAsync: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
    Paths: { cache: '/cache' },
    File: class {
        uri: string;
        exists = true;
        write = vi.fn();
        delete = vi.fn();

        constructor(_directory: string, name: string) {
            this.uri = `/cache/${name}`;
            mocks.files.push(this);
        }
    },
}));

vi.mock('expo-sharing', () => ({
    shareAsync: mocks.shareAsync,
}));

import { shareAttachmentFile } from './shareAttachmentFile';

const attachment: AttachmentContent = {
    v: 2,
    id: 'attachment-1',
    kind: 'file',
    name: 'private?.txt',
    mimeType: 'text/plain',
    size: 3,
    encryption: {
        algorithm: 'secretbox',
        key: 'key',
        nonce: 'nonce',
        plaintextSha256: 'hash',
        ciphertextSize: 19,
    },
};

describe('shareAttachmentFile', () => {
    beforeEach(() => {
        mocks.files.length = 0;
        mocks.shareAsync.mockReset();
    });

    it('deletes the plaintext file after sharing succeeds', async () => {
        mocks.shareAsync.mockResolvedValue(undefined);

        await shareAttachmentFile(attachment, new Uint8Array([1, 2, 3]));

        expect(mocks.shareAsync).toHaveBeenCalledWith('/cache/attachment-1-private_.txt', { mimeType: 'text/plain' });
        expect(mocks.files[0].delete).toHaveBeenCalledOnce();
    });

    it('deletes the plaintext file when sharing fails', async () => {
        mocks.shareAsync.mockRejectedValue(new Error('cancelled'));

        await expect(shareAttachmentFile(attachment, new Uint8Array([1, 2, 3]))).rejects.toThrow('cancelled');

        expect(mocks.files[0].delete).toHaveBeenCalledOnce();
    });
});

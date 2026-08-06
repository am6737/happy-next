import { describe, expect, it, vi } from 'vitest';
import type { LocalAttachment } from '@/components/AttachmentPreview';
import type { AttachmentContent } from './typesRaw';
import { PreparedAttachmentUpload, uploadAttachmentBatch } from './uploadAttachmentBatch';

const localAttachments: LocalAttachment[] = [
    { uri: 'file:first', name: 'first.txt', mimeType: 'text/plain', size: 1 },
    { uri: 'file:second', name: 'second.txt', mimeType: 'text/plain', size: 2 },
    { uri: 'file:third', name: 'third.txt', mimeType: 'text/plain', size: 3 },
];

function uploadedAttachment(index: number): AttachmentContent {
    return {
        v: 2,
        id: `uploaded-${index}`,
        kind: 'file',
        name: localAttachments[index].name,
        mimeType: 'text/plain',
        size: localAttachments[index].size,
        encryption: {
            algorithm: 'secretbox',
            key: `key-${index}`,
            nonce: `nonce-${index}`,
            plaintextSha256: `hash-${index}`,
            ciphertextSize: localAttachments[index].size + 16,
        },
    };
}

describe('uploadAttachmentBatch', () => {
    it('keeps successful uploads and resumes after a later attachment fails', async () => {
        let cached: PreparedAttachmentUpload | undefined;
        const firstAttempt = vi.fn()
            .mockResolvedValueOnce(uploadedAttachment(0))
            .mockRejectedValueOnce(new Error('upload failed'));

        await expect(uploadAttachmentBatch({
            attachments: localAttachments,
            fingerprint: 'same-message',
            cached,
            upload: firstAttempt,
            onProgress: (progress) => { cached = progress; },
        })).rejects.toThrow('upload failed');

        expect(cached?.attachments).toEqual([uploadedAttachment(0)]);

        const retry = vi.fn()
            .mockResolvedValueOnce(uploadedAttachment(1))
            .mockResolvedValueOnce(uploadedAttachment(2));
        const result = await uploadAttachmentBatch({
            attachments: localAttachments,
            fingerprint: 'same-message',
            cached,
            upload: retry,
            onProgress: (progress) => { cached = progress; },
        });

        expect(retry).toHaveBeenCalledTimes(2);
        expect(retry).toHaveBeenNthCalledWith(1, localAttachments[1]);
        expect(result).toEqual([
            uploadedAttachment(0),
            uploadedAttachment(1),
            uploadedAttachment(2),
        ]);
    });
});

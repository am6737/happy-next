import { describe, expect, it } from 'vitest';
import { getAttachmentKind } from './attachmentMime';

describe('getAttachmentKind', () => {
    it.each([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'IMAGE/PNG',
        'image/jpeg; charset=binary',
    ])('classifies supported model image MIME type %s as an image', (mimeType) => {
        expect(getAttachmentKind(mimeType)).toBe('image');
    });

    it.each([
        'image/svg+xml',
        'image/tiff',
        'image/bmp',
        'application/pdf',
        'text/plain',
    ])('classifies unsupported MIME type %s as a file', (mimeType) => {
        expect(getAttachmentKind(mimeType)).toBe('file');
    });
});

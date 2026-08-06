import { describe, expect, it } from 'vitest';
import { localImagesToAttachments } from './localImageAttachments';

describe('localImagesToAttachments', () => {
    it('preserves private image metadata for encrypted attachment messages', () => {
        expect(localImagesToAttachments([
            { uri: 'blob:first', width: 1200, height: 800, mimeType: 'image/png' },
            { uri: 'file:second', width: 640, height: 640, mimeType: 'image/webp' },
        ])).toEqual([
            {
                uri: 'blob:first',
                name: 'image-1.png',
                mimeType: 'image/png',
                size: 0,
                image: { width: 1200, height: 800 },
            },
            {
                uri: 'file:second',
                name: 'image-2.webp',
                mimeType: 'image/webp',
                size: 0,
                image: { width: 640, height: 640 },
            },
        ]);
    });
});

import { describe, expect, it } from 'vitest';
import { getFilePreviewType, openFilePreviewRequestSchema, filePreviewChunkRequestSchema } from './filePreview';

describe('file preview contract', () => {
    it('uses only own extension entries', () => {
        expect(getFilePreviewType('a.__proto__')).toBeNull();
        expect(getFilePreviewType('a.constructor')).toBeNull();
        expect(getFilePreviewType('a.SVG')).toEqual({ kind: 'svg', mimeType: 'image/svg+xml' });
        expect(getFilePreviewType('readme.markdown')?.kind).toBe('markdown');
    });
    it('rejects invalid versions and chunk offsets', () => {
        expect(openFilePreviewRequestSchema.safeParse({ path: 'x.pdf', repoPath: '.', version: 'HEAD', compare: true }).success).toBe(false);
        expect(filePreviewChunkRequestSchema.safeParse({ token: 'not-a-token', offset: -1 }).success).toBe(false);
    });
});

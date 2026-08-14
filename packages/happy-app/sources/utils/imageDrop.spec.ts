import { describe, expect, it } from 'vitest';
import { getDroppedImageFiles, isFileDrag } from './imageDrop';

describe('imageDrop', () => {
    it('recognizes external file drags without treating text drags as files', () => {
        expect(isFileDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
        expect(isFileDrag({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
        expect(isFileDrag(null)).toBe(false);
    });

    it('keeps only image files from a mixed drop', () => {
        const image = { name: 'screen.png', type: 'image/png' } as File;
        const text = { name: 'notes.txt', type: 'text/plain' } as File;
        const files = { 0: image, 1: text, length: 2, item: () => null } as unknown as FileList;

        expect(getDroppedImageFiles({ files } as DataTransfer)).toEqual([image]);
    });

    it('returns an empty list when drop data is missing', () => {
        expect(getDroppedImageFiles(null)).toEqual([]);
    });
});

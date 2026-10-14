import { describe, expect, it } from 'vitest';
import { getDroppedFiles, isFileDrag, splitComposerFiles } from './fileDrop';

const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const image = { name: 'screen.png', type: 'image/png' } as File;
const svg = { name: 'logo.svg', type: 'image/svg+xml' } as File;
const text = { name: 'notes.txt', type: 'text/plain' } as File;

describe('fileDrop', () => {
    it('recognizes external file drags without treating text drags as files', () => {
        expect(isFileDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
        expect(isFileDrag({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
        expect(isFileDrag(null)).toBe(false);
    });

    it('keeps every dropped file', () => {
        const files = { 0: image, 1: text, length: 2, item: () => null } as unknown as FileList;
        expect(getDroppedFiles({ files } as DataTransfer)).toEqual([image, text]);
        expect(getDroppedFiles(null)).toEqual([]);
    });

    it('sends supported images as images and everything else as files', () => {
        expect(splitComposerFiles([image, svg, text], { imageTypes: IMAGE_TYPES, supportsImages: true, canAttachFiles: true }))
            .toEqual({ images: [image], files: [svg, text] });
    });

    it('sends images as files when the AI has no image support', () => {
        expect(splitComposerFiles([image, text], { imageTypes: IMAGE_TYPES, supportsImages: false, canAttachFiles: true }))
            .toEqual({ images: [], files: [image, text] });
    });

    it('leaves out files when they cannot be attached', () => {
        expect(splitComposerFiles([image, text], { imageTypes: IMAGE_TYPES, supportsImages: true, canAttachFiles: false }))
            .toEqual({ images: [image], files: [] });
    });
});

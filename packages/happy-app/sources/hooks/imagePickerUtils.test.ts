import { describe, expect, it } from 'vitest';
import { appendImagesWithinLimit } from './imagePickerUtils';

describe('appendImagesWithinLimit', () => {
    it('caps a batch at the image limit', () => {
        expect(appendImagesWithinLimit([], [1, 2, 3, 4, 5, 6], 4)).toEqual([1, 2, 3, 4]);
    });

    it('uses the latest image state when several stale async additions complete', () => {
        let images: number[] = [1, 2];

        images = appendImagesWithinLimit(images, [3], 4);
        images = appendImagesWithinLimit(images, [4], 4);
        images = appendImagesWithinLimit(images, [5], 4);

        expect(images).toEqual([1, 2, 3, 4]);
    });

    it('does not replace the array when it is already full', () => {
        const images = [1, 2, 3, 4];
        expect(appendImagesWithinLimit(images, [5], 4)).toBe(images);
    });
});

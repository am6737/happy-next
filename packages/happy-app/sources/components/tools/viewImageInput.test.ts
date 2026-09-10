import { describe, expect, it } from 'vitest';
import { getViewImagePath, getViewImageDisplayPath } from './viewImageInput';

describe('view_image summary', () => {
    it.each([
        '/tmp/internal-installing-desktop.png',
        'C:\\Users\\user\\Desktop\\image.png',
        'relative/image with spaces.jpg',
    ])('preserves the path when the home directory is unknown: %s', (path) => {
        expect(getViewImagePath({ path })).toBe(path);
        expect(getViewImageDisplayPath({ path })).toBe(path);
    });

    it.each([null, {}, { path: 1 }, { path: '' }, { path: ' ' }])('handles missing or malformed input %j', (input) => {
        expect(getViewImagePath(input)).toBeNull();
        expect(getViewImageDisplayPath(input)).toBeNull();
    });

    it.each([
        ['/Users/alice/Desktop/image.png', '/Users/alice', '~/Desktop/image.png'],
        ['/Users/alice/Desktop/image.png', '/Users/alice/', '~/Desktop/image.png'],
        ['/Users/alice', '/Users/alice', '~'],
        ['/Users/alice-other/image.png', '/Users/alice', '/Users/alice-other/image.png'],
        ['/Users/Alice/image.png', '/Users/alice', '/Users/Alice/image.png'],
        ['/tmp/image.png', '/Users/alice', '/tmp/image.png'],
        ['/tmp/image.png', '/', '/tmp/image.png'],
        ['C:\\Users\\Alice\\Desktop\\image.png', 'c:\\users\\alice\\', '~\\Desktop\\image.png'],
        ['C:/Users/Alice/Desktop/image.png', 'C:\\Users\\Alice', '~/Desktop/image.png'],
        ['C:\\Users\\AliceOther\\image.png', 'C:\\Users\\Alice', 'C:\\Users\\AliceOther\\image.png'],
    ])('abbreviates only the actual home directory in %s', (path, homeDir, expected) => {
        const input = { path };
        expect(getViewImageDisplayPath(input, homeDir)).toBe(expected);
        expect(input.path).toBe(path);
    });
});

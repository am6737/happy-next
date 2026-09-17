import { describe, expect, it } from 'vitest';
import { getToolImageDisplayPath } from './toolImagePath';

// Which calls have an image at all is covered by happy-wire's getToolImagePath; this is the display form.
describe('tool image display path', () => {
    it.each([
        ['view_image', { path: 1 }],
        ['view_image', { path: ' ' }],
        ['view_image', null],
        ['Read', undefined],
        ['Read', { file_path: '/tmp/notes.md' }],
    ])('has no display path for %s %j', (toolName, input) => {
        expect(getToolImageDisplayPath(toolName, input)).toBeNull();
    });

    it.each([
        '/tmp/internal-installing-desktop.png',
        'C:\\Users\\user\\Desktop\\image.png',
        'relative/image with spaces.jpg',
    ])('preserves the path when the home directory is unknown: %s', (path) => {
        expect(getToolImageDisplayPath('view_image', { path })).toBe(path);
        expect(getToolImageDisplayPath('Read', { file_path: path })).toBe(path);
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
        expect(getToolImageDisplayPath('view_image', input, homeDir)).toBe(expected);
        expect(input.path).toBe(path);
    });

    it('abbreviates a read path the same way, home directory included', () => {
        expect(getToolImageDisplayPath('Read', { file_path: '/Users/alice/Desktop/image.png' }, '/Users/alice')).toBe('~/Desktop/image.png');
        expect(getToolImageDisplayPath('Read', { file_path: '/tmp/image.png' }, '/Users/alice')).toBe('/tmp/image.png');
    });
});

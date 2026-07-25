import { describe, expect, it } from 'vitest';

import { formatMessagePreviewText, truncateMessagePreviewText } from './messagePreviewText';

describe('formatMessagePreviewText', () => {
    it('preserves visible text while removing Markdown formatting', () => {
        expect(formatMessagePreviewText([
            '## **Important** update',
            '> Read the [documentation](https://example.com).',
            '- Run `yarn typecheck`',
            '1. Keep ~~obsolete~~ useful context',
        ].join('\n'))).toBe(
            'Important update Read the documentation. Run yarn typecheck Keep obsolete useful context',
        );
    });

    it('replaces fenced code blocks and removes their contents', () => {
        expect(formatMessagePreviewText([
            'Implemented the fix:',
            '```ts',
            'const secret = "do-not-preview";',
            '```',
            'Ready to review.',
        ].join('\n'))).toBe('Implemented the fix: [Code] Ready to review.');

        expect(formatMessagePreviewText('```\nunclosed code')).toBe('[Code]');
    });

    it('uses image alt text or a placeholder and collapses whitespace', () => {
        expect(formatMessagePreviewText('See ![build result](image.png)\n\nand ![](empty.png)'))
            .toBe('See build result and [Image]');
    });

    it('does not remove meaningful punctuation from plain text', () => {
        expect(formatMessagePreviewText('Use C++, foo_bar, foo__bar__, Promise<T>, a * b, and path/to/file.'))
            .toBe('Use C++, foo_bar, foo__bar__, Promise<T>, a * b, and path/to/file.');
    });
});

describe('truncateMessagePreviewText', () => {
    it('truncates by Unicode characters without splitting an emoji', () => {
        expect(truncateMessagePreviewText('你好🙂世界', 3)).toBe('你好🙂...');
    });
});

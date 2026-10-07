import { describe, expect, it } from 'vitest';
import { highlightTextToHtml } from './highlightTextToHtml';

function sourceText(html: string): string {
    return html.replace(/<span class="[^"]*">|<\/span>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

describe('selectable source highlighting', () => {
    it('highlights HTML and embedded CSS/JavaScript without Markdown emphasis or links', () => {
        const text = '<html><style>* { margin: 0 } [hidden] { display: none }</style><script>const value = 42;</script><body>Hello</body></html>';
        const result = highlightTextToHtml(text, 'html');
        expect(result).toContain('tok-typeName">html</span>');
        expect(result).toContain('tok-propertyName">hidden</span>');
        expect(result).toContain('tok-keyword');
        expect(result).not.toMatch(/tok-(emphasis|strong|link|url)/);
        expect(sourceText(result)).toBe(text);
        expect(result).not.toContain('<script>');
    });

    it('retains Markdown highlighting for messages', () => {
        const result = highlightTextToHtml('# Title\n\n*hello* [link](https://example.com)', 'markdown');
        expect(result).toContain('tok-heading');
        expect(result).toContain('tok-emphasis');
        expect(result).toContain('tok-link');
    });

    it.each([
        ['json', '{\r\n\t"name": "你好 & <world>", "value": 42\r\n}\r\n'],
        ['html', '<div title="a & b">你好 🐱</div>\r\n\r\n'],
        ['markdown', '# Title\r\n\r\n*你好* & <text>\n'],
        ['javascript', 'const text = "&amp; <span> 🐱";\r\n'],
        ['shell', '# comment\n\necho "你好"\n'],
        ['sql', 'SELECT * FROM example WHERE value = 42;\n'],
    ])('preserves every original character for %s, including line endings', (language, text) => {
        const result = highlightTextToHtml(text, language);
        expect(result).toContain('<span');
        expect(sourceText(result)).toBe(text);
    });

    it.each(['plaintext', 'unsupported'])('escapes %s without applying Markdown or executing HTML', (language) => {
        const text = '*text* [hidden]\n<script>alert("hello")</script> &amp;';
        const result = highlightTextToHtml(text, language);
        expect(result).not.toContain('<span');
        expect(result).not.toContain('<script>');
        expect(sourceText(result)).toBe(text);
    });
});

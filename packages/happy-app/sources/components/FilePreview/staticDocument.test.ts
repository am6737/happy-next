import { describe, expect, it } from 'vitest';
import {
    buildHtmlDocument,
    buildMarkdownDocument,
    buildSvgDocument,
    markdownPreviewHtml,
} from './staticDocument';

describe('static file previews', () => {
    it('renders HTML as authored, keeping scripts, handlers and external resources', () => {
        const source =
            '<style>body{background-image:url(https://example.com/a.css)}</style><h1 onclick="alert(1)">Hi</h1><script>parent.hacked=true;fetch("https://example.com/x")</script><img src="https://example.com/image.png" alt="remote"><iframe src="https://example.com"></iframe><form action="https://example.com"><input></form>';
        expect(buildHtmlDocument(source)).toBe(source);
        expect(buildHtmlDocument(source)).not.toContain(
            'Content-Security-Policy'
        );
    });
    it('adds dark reading colors after author styles without adding a script', () => {
        const light = buildHtmlDocument('<style>body{color:black}</style>');
        const dark = buildHtmlDocument('<style>body{color:black}</style>', true);
        expect(light).not.toContain('color-scheme:dark');
        expect(dark).toContain('color-scheme:dark!important');
        expect(dark).toContain('background-color:#202124!important');
        expect(dark).not.toContain('<script');
        expect(
            dark.lastIndexOf('color:#e5e7eb!important')
        ).toBeGreaterThan(dark.indexOf('body{color:black}'));
    });
    it('places dark colors before the closing tags and appends when absent', () => {
        const document = buildHtmlDocument(
            '<html><head></head><body><p>Hi</p></body></html>',
            true
        );
        expect(document.indexOf('color-scheme:dark')).toBeLessThan(
            document.lastIndexOf('</body>')
        );
        const fragment = buildHtmlDocument('<p>Hi</p>', true);
        expect(fragment.startsWith('<p>Hi</p>')).toBe(true);
        expect(fragment).toContain('color-scheme:dark!important');
    });
    it('keeps Markdown escaped and script-free behind a restrictive CSP', () => {
        for (const dark of [false, true]) {
            const document = buildMarkdownDocument('Hello', dark);
            expect(document).toContain("script-src 'none'");
            expect(document).toContain("connect-src 'none'");
            expect(document).toContain("default-src 'none'");
            expect(document).toContain("base-uri 'none'");
            expect(document).not.toContain('<script');
            expect(document).toContain('color-scheme:light');
        }
        const dark = buildMarkdownDocument(
            '<style>body{color:black}</style>',
            true
        );
        expect(dark).toContain('color-scheme:dark!important');
        expect(dark.lastIndexOf('color:#e5e7eb!important')).toBeGreaterThan(
            dark.indexOf('body{color:black}')
        );
    });
    it('escapes raw Markdown HTML and renders headings, tables, lists and code', () => {
        const result = markdownPreviewHtml(
            '# Title\n\n- Item\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n```html\n<script>alert(1)</script>\n```\n\n<script>bad()</script>'
        );
        expect(result).toContain('<h1>Title</h1>');
        expect(result).toContain('<li');
        expect(result).toContain('<table>');
        expect(result).toContain('&lt;script&gt;');
        expect(result).not.toContain('<script>');
    });
    it('does not activate Mermaid, chat options, links or remote images', () => {
        const result = markdownPreviewHtml(
            '```mermaid\ngraph TD; A-->B\n```\n\n![remote](https://example.com/a.png)\n\n[link](javascript:alert(1))'
        );
        expect(result).toContain('<pre><code>');
        expect(result).not.toContain('<img');
        expect(result).not.toContain('href=');
        expect(result).not.toContain('<script');
    });
    it('keeps SVG inside an image context without inserting its markup', () => {
        const source = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        ).toString('base64');
        const result = buildSvgDocument(source, false, 99);
        expect(result).toContain('data:image/svg+xml;base64,');
        expect(result).not.toContain('<svg');
        expect(result).toContain('width:400vw');
        expect(result).toContain("script-src 'none'");
        expect(() => buildSvgDocument('"><script>', false, 1)).toThrow();
    });
});

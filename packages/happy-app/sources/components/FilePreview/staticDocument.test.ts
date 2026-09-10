import { describe, expect, it } from 'vitest';
import {
    buildStaticDocument,
    buildSvgDocument,
    markdownPreviewHtml,
    sanitizeStaticHtml,
} from './staticDocument';

describe('static file previews', () => {
    it('adds dark reading colors after author styles without enabling scripts', () => {
        for (const kind of ['html', 'markdown'] as const) {
            const light = buildStaticDocument('Hello', kind);
            const dark = buildStaticDocument('Hello', kind, true);
            expect(light).not.toContain('color-scheme:dark');
            expect(dark).toContain('color-scheme:dark!important');
            expect(dark).toContain('background-color:#202124!important');
            expect(dark).toContain("script-src 'none'");
            expect(dark).not.toContain('<script');
        }
        const html = buildStaticDocument('<style>body{color:black}</style>', 'html', true);
        expect(html.lastIndexOf('color:#e5e7eb!important')).toBeGreaterThan(html.indexOf('body{color:black}'));
    });
    it('preserves static HTML and inline styles', () => {
        expect(
            sanitizeStaticHtml(
                '<h1 class="title">Hello &amp; world</h1><style>.title{color:red}</style>'
            )
        ).toBe(
            '<h1 class="title">Hello &amp; world</h1><style>.title{color:red}</style>'
        );
    });
    it('removes scripts, events, navigation and nested documents', () => {
        const result = sanitizeStaticHtml(
            '<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><h1 onclick="alert(1)">Hi</h1><script>alert(1)</script><iframe src="https://example.com"></iframe><a href="javascript:alert(1)">link</a><form action="https://example.com"><input></form>'
        );
        expect(result).toBe('<h1>Hi</h1>link');
    });
    it('allows only embedded raster images, not srcset or remote images', () => {
        expect(
            sanitizeStaticHtml(
                '<img src="https://example.com/image.png" alt="remote"><img src="data:image/png;base64,YQ==" srcset="https://example.com/a.png">'
            )
        ).toBe('<span>remote</span><img src="data:image/png;base64,YQ==">');
    });
    it('blocks resources and document execution with CSP', () => {
        const result = buildStaticDocument(
            '<style>@import "https://example.com/a.css";</style>',
            'html'
        );
        expect(result).toContain("script-src 'none'");
        expect(result).toContain("connect-src 'none'");
        expect(result).toContain("default-src 'none'");
        expect(result).toContain("base-uri 'none'");
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

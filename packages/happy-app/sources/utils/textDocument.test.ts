import { describe, expect, it } from 'vitest';
import { resolveTextDocument } from './textDocument';

const html = '<!DOCTYPE html><html><head><style>* { margin: 0 } [hidden] { display: none }</style></head><body>Hello</body></html>';

describe('text document format', () => {
    it.each([
        html,
        ' \n<!-- generated -->\n' + html,
        '<HTML lang="zh"><body>Hello</body></HTML>\n',
    ])('detects a standalone HTML document without source metadata', (text) => {
        expect(resolveTextDocument({ text })).toEqual({ format: 'html', language: 'html' });
    });

    it.each([
        '# Hello\n\n**world**',
        '```html\n' + html + '\n```',
        'Example: ' + html,
        '<div>Hello</div>',
        '* { margin: 0 } [hidden] { display: none }',
        'Use <html> for the root element.',
        '',
    ])('does not guess HTML from Markdown, prose, or fragments', (text) => {
        expect(resolveTextDocument({ text }).format).toBe('markdown');
    });

    it('keeps a Markdown message as Markdown even when it contains a full HTML document', () => {
        expect(resolveTextDocument({ text: html, sourceFormat: 'markdown' })).toEqual({ format: 'markdown', language: 'markdown' });
    });

    it('renders a known HTML fragment as HTML', () => {
        expect(resolveTextDocument({ text: '<div>Hello</div>', sourceLanguage: 'htm' })).toEqual({ format: 'html', language: 'html' });
    });

    it.each(['json', 'css', 'typescript', 'python', 'rust'])('preserves the known code language %s', (language) => {
        expect(resolveTextDocument({ text: html, sourceLanguage: language })).toEqual({ format: 'plain', language });
    });

    it('gives an explicit source format priority over language and content guesses', () => {
        expect(resolveTextDocument({ text: html, sourceFormat: 'plain', sourceLanguage: 'css' })).toEqual({ format: 'plain', language: 'css' });
        expect(resolveTextDocument({ text: html, sourceFormat: 'markdown', sourceLanguage: 'html' })).toEqual({ format: 'markdown', language: 'markdown' });
    });

    it('lets the user override the source and return to automatic interpretation', () => {
        const source = { text: html, sourceFormat: 'markdown' };
        expect(resolveTextDocument({ ...source, mode: 'html' })).toEqual({ format: 'html', language: 'html' });
        expect(resolveTextDocument({ ...source, mode: 'plain', sourceLanguage: 'json' })).toEqual({ format: 'plain', language: 'plaintext' });
        expect(resolveTextDocument({ ...source, mode: 'auto' })).toEqual({ format: 'markdown', language: 'markdown' });
    });

    it('lets a concrete code-language choice restore syntax highlighting after a plain-text override', () => {
        const source = { text: '{"name":"hello"}', sourceFormat: 'markdown' };
        expect(resolveTextDocument({ ...source, mode: 'json' })).toEqual({ format: 'plain', language: 'json' });
        expect(resolveTextDocument({ ...source, mode: 'typescript' })).toEqual({ format: 'plain', language: 'typescript' });
    });

    it('ignores invalid format hints and normalizes language aliases', () => {
        expect(resolveTextDocument({ text: html, sourceFormat: 'unknown' }).format).toBe('html');
        expect(resolveTextDocument({ text: html, sourceLanguage: ' TS ' })).toEqual({ format: 'plain', language: 'typescript' });
    });
});

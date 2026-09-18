/**
 * Unit tests for preview_html file resolution
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn()
    }
}));

import {
    MAX_PREVIEW_HTML_FILE_BYTES,
    inlinePreviewHtmlFileArgs,
    isPreviewHtmlToolName,
    readPreviewHtmlFile,
} from './previewHtmlFile';

const workDir = mkdtempSync(join(tmpdir(), 'preview-html-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function writeFixture(name: string, content: string | Buffer): string {
    const filePath = join(workDir, name);
    writeFileSync(filePath, content);
    return filePath;
}

describe('isPreviewHtmlToolName', () => {
    it.each([
        'preview_html',
        'happy__preview_html',
        'mcp__happy__preview_html',
        'mcp:happy:preview_html',
    ])('matches %s', (name) => {
        expect(isPreviewHtmlToolName(name)).toBe(true);
    });

    it.each([
        'change_title',
        'mcp__happy__change_title',
        'orchestrator_submit',
        'preview_html_extra',
        undefined,
        null,
        42,
    ])('rejects %s', (name) => {
        expect(isPreviewHtmlToolName(name)).toBe(false);
    });
});

describe('readPreviewHtmlFile', () => {
    it('reads a file as utf8', () => {
        const filePath = writeFixture('page.html', '<html><body>你好</body></html>');
        expect(readPreviewHtmlFile(filePath)).toEqual({
            ok: true,
            html: '<html><body>你好</body></html>',
        });
    });

    it('refuses a directory', () => {
        const dir = join(workDir, 'sub');
        mkdirSync(dir, { recursive: true });
        const result = readPreviewHtmlFile(dir);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.error).toContain('directory');
    });

    it('refuses a file above the size cap', () => {
        const filePath = writeFixture('huge.html', Buffer.alloc(MAX_PREVIEW_HTML_FILE_BYTES + 1));
        const result = readPreviewHtmlFile(filePath);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.error).toContain('too large');
    });

    it('reports a missing file instead of throwing', () => {
        const result = readPreviewHtmlFile(join(workDir, 'nope.html'));
        expect(result.ok).toBe(false);
    });
});

describe('inlinePreviewHtmlFileArgs', () => {
    it('inlines the document when only filePath is given', () => {
        const filePath = writeFixture('inline.html', '<h1>hi</h1>');
        expect(inlinePreviewHtmlFileArgs('mcp__happy__preview_html', { filePath, title: 'T' }))
            .toEqual({ filePath, title: 'T', html: '<h1>hi</h1>' });
    });

    it('leaves inline html alone', () => {
        const args = { html: '<p>inline</p>', filePath: '/ignored.html' };
        expect(inlinePreviewHtmlFileArgs('preview_html', args)).toBe(args);
    });

    it('ignores other tools', () => {
        const args = { filePath: writeFixture('other.html', '<p>x</p>') };
        expect(inlinePreviewHtmlFileArgs('mcp__happy__change_title', args)).toBe(args);
    });

    it('leaves args untouched when the file cannot be read', () => {
        const args = { filePath: join(workDir, 'missing.html') };
        expect(inlinePreviewHtmlFileArgs('preview_html', args)).toBe(args);
    });

    it('leaves args untouched when no file path is present', () => {
        const args = { title: 'T' };
        expect(inlinePreviewHtmlFileArgs('preview_html', args)).toBe(args);
    });

    it('passes through undefined args', () => {
        expect(inlinePreviewHtmlFileArgs('preview_html', undefined)).toBeUndefined();
    });
});

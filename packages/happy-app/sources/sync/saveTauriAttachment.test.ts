import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTauriDesktop, sanitizeAttachmentFilename } from './saveTauriAttachment';

describe('isTauriDesktop', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('recognizes the current Tauri runtime marker', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('isTauri', true);
        expect(isTauriDesktop()).toBe(true);
    });

    it('keeps compatibility with the legacy internals marker', () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        expect(isTauriDesktop()).toBe(true);
    });

    it('does not identify a normal browser as Tauri', () => {
        vi.stubGlobal('window', {});
        expect(isTauriDesktop()).toBe(false);
    });
});

describe('sanitizeAttachmentFilename', () => {
    it('preserves normal and unicode filenames', () => {
        expect(sanitizeAttachmentFilename('archive.zip')).toBe('archive.zip');
        expect(sanitizeAttachmentFilename('测试文件.zip')).toBe('测试文件.zip');
    });

    it('removes path separators and characters invalid on desktop filesystems', () => {
        expect(sanitizeAttachmentFilename('../folder\\report?.zip')).toBe('.._folder_report_.zip');
    });

    it('returns a usable name for empty and reserved filenames', () => {
        expect(sanitizeAttachmentFilename('...')).toBe('attachment');
        expect(sanitizeAttachmentFilename('CON.txt')).toBe('_CON.txt');
    });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/text', () => ({
    // Mirrors the `files.preview.*` entries of the English translations.
    t: (key: string) => {
        const labels: Record<string, string> = {
            'files.preview.index': 'Staged version',
            'files.preview.commit': 'Commit',
        };
        return labels[key];
    },
}));

import { fileRouteNotice } from './fileNotice';

describe('fileRouteNotice', () => {
    it('prefers the label the list already computed', () => {
        expect(fileRouteNotice({ note: 'Staged version', ref: 'a'.repeat(40) })).toBe('Staged version');
    });

    it('abbreviates the commit the file was opened from', () => {
        expect(fileRouteNotice({ ref: '1a2b3c4d5e6f7a8b9c0d' })).toBe('Commit 1a2b3c4d');
    });

    it('falls back to the staged label when only the staged flag is set', () => {
        expect(fileRouteNotice({ staged: true })).toBe('Staged version');
    });

    it('shows nothing for a working-tree file', () => {
        expect(fileRouteNotice({})).toBeNull();
        expect(fileRouteNotice({ staged: false })).toBeNull();
    });
});

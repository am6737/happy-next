import { describe, expect, it } from 'vitest';
import { hasWebTextSelection } from './webTextSelection';

describe('hasWebTextSelection', () => {
    it('is false without a selection object', () => {
        expect(hasWebTextSelection(() => null)).toBe(false);
    });

    it('is false for a collapsed selection', () => {
        expect(hasWebTextSelection(() => ({ toString: () => '' }))).toBe(false);
    });

    it('is true when text is selected', () => {
        expect(hasWebTextSelection(() => ({ toString: () => 'hello' }))).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';
import { appendWithinLimit } from './imageSelection';

describe('appendWithinLimit', () => {
    it('fills only the remaining attachment slots', () => {
        expect(appendWithinLimit(['one', 'two', 'three'], ['four', 'five'], 4))
            .toEqual(['one', 'two', 'three', 'four']);
    });

    it('keeps the current array when it is already full', () => {
        const current = ['one', 'two'];
        expect(appendWithinLimit(current, ['three'], 2)).toBe(current);
    });
});

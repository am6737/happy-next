import { describe, expect, it } from 'vitest';
import { shouldDismissSessionMenuOnScroll } from './sessionContextMenuScroll';

const row = {};
const sessionListScroller = { contains: (other: unknown) => other === row };
const chatScroller = { contains: () => false };
const documentNode = { contains: () => true };

describe('sessionContextMenuScroll', () => {
    describe('shouldDismissSessionMenuOnScroll', () => {
        it('keeps the menu open when the chat pane scrolls under it', () => {
            expect(shouldDismissSessionMenuOnScroll(chatScroller, row)).toBe(false);
        });

        it('dismisses when the scrolled container holds the row', () => {
            expect(shouldDismissSessionMenuOnScroll(sessionListScroller, row)).toBe(true);
        });

        it('dismisses on a page scroll', () => {
            expect(shouldDismissSessionMenuOnScroll(documentNode, row)).toBe(true);
        });

        it('dismisses when no row was recorded', () => {
            expect(shouldDismissSessionMenuOnScroll(chatScroller, null)).toBe(true);
        });

        it('dismisses on a scroll target that cannot be placed', () => {
            expect(shouldDismissSessionMenuOnScroll(null, row)).toBe(true);
            expect(shouldDismissSessionMenuOnScroll({}, row)).toBe(true);
        });
    });
});

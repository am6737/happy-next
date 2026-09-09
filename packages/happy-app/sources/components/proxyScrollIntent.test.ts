import { describe, expect, it } from 'vitest';
import { createProxyScrollIntent } from './proxyScrollIntent';

describe('proxy scroll input ownership', () => {
    it('rejects programmatic and range-change events without user input', () => {
        const intent = createProxyScrollIntent(160);
        expect(intent.acceptScroll(0)).toBe(false);
        expect(intent.acceptScroll(1000)).toBe(false);
    });

    it('accepts a held scrollbar drag and its final deferred event', () => {
        const intent = createProxyScrollIntent(160);
        intent.pointerDown(0);
        expect(intent.acceptScroll(1000)).toBe(true);
        intent.pointerUp(1100);
        expect(intent.acceptScroll(1116)).toBe(true);
        expect(intent.acceptScroll(1276)).toBe(false);
    });

    it('accepts wheel or keyboard input and ongoing momentum', () => {
        const intent = createProxyScrollIntent(160);
        intent.input(0);
        expect(intent.acceptScroll(100)).toBe(true);
        expect(intent.acceptScroll(200)).toBe(true);
        expect(intent.acceptScroll(360)).toBe(false);
    });

    it('does not let a delayed proxy event undo a minimap jump', () => {
        const intent = createProxyScrollIntent(160);
        intent.input(0);
        intent.cancel();
        expect(intent.acceptScroll(3)).toBe(false);
        intent.pointerDown(10);
        expect(intent.acceptScroll(11)).toBe(true);
    });
});

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const xtermEntry = requireFromHere.resolve('@xterm/headless');

const realNavigator = globalThis.navigator;
const realTitle = process.title;

/**
 * The globals the phone actually has: React Native's `navigator` carries only
 * `product`, and Hermes' `process` has no `title`. Node has both, so the
 * failure this shim exists for cannot be seen without taking them away first.
 */
function asHermes(): void {
    Object.defineProperty(globalThis, 'navigator', {
        value: { product: 'ReactNative' },
        configurable: true,
        writable: true,
    });
    delete (process as { title?: string }).title;
}

function loadXterm(): typeof import('@xterm/headless') {
    delete requireFromHere.cache[xtermEntry];
    return requireFromHere(xtermEntry);
}

afterAll(() => {
    Object.defineProperty(globalThis, 'navigator', {
        value: realNavigator,
        configurable: true,
        writable: true,
    });
    process.title = realTitle;
});

describe('xtermPlatformShim', () => {
    // Fails if a future version of the library stops reading `navigator` while
    // it initialises — that is the signal this shim can be deleted, not a bug
    // to work around.
    it('is what stands between Hermes and a library that will not load', () => {
        asHermes();
        expect(loadXterm).toThrow(/undefined/);
    });

    it('gives the library a user agent and a platform it can read', async () => {
        asHermes();
        vi.resetModules();
        await import('./xtermPlatformShim');

        const { Terminal } = loadXterm();
        const terminal = new Terminal({ rows: 12, cols: 48, allowProposedApi: true });
        expect([terminal.rows, terminal.cols]).toEqual([12, 48]);
        terminal.dispose();
    });

    it('leaves a real user agent and platform alone', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel' },
            configurable: true,
            writable: true,
        });
        vi.resetModules();
        await import('./xtermPlatformShim');

        expect(globalThis.navigator.userAgent).toBe('Mozilla/5.0 (Macintosh)');
        expect(globalThis.navigator.platform).toBe('MacIntel');
    });
});

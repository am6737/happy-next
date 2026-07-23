import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    openBrowserAsync: vi.fn(),
    openURL: vi.fn(),
    windowOpen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: mocks.openBrowserAsync }));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    Linking: { openURL: mocks.openURL },
}));

import { isAllowedExternalUrl, isTauriDesktop, openExternalUrl } from './tauri';

describe('Tauri desktop helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('window', { open: mocks.windowOpen });
    });

    it('detects the Tauri runtime and opens URLs through the native opener', async () => {
        vi.stubGlobal('window', {
            __TAURI_INTERNALS__: {},
            open: mocks.windowOpen,
        });

        expect(isTauriDesktop()).toBe(true);

        await openExternalUrl('https://example.com');

        expect(mocks.invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
            url: 'https://example.com',
            with: null,
        });
        expect(mocks.windowOpen).not.toHaveBeenCalled();
    });

    it('keeps regular web links in a separate browser tab outside Tauri', async () => {
        expect(isTauriDesktop()).toBe(false);

        await openExternalUrl('https://example.com');

        expect(mocks.windowOpen).toHaveBeenCalledWith(
            'https://example.com',
            '_blank',
            'noopener,noreferrer',
        );
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('only permits external protocols handled by the operating system', async () => {
        expect(isAllowedExternalUrl('https://example.com')).toBe(true);
        expect(isAllowedExternalUrl('mailto:support@example.com')).toBe(true);
        expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
        expect(isAllowedExternalUrl('not a url')).toBe(false);

        await expect(openExternalUrl('javascript:alert(1)')).resolves.toBeUndefined();
        expect(mocks.windowOpen).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});

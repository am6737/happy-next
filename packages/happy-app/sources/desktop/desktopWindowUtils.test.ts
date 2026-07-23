import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isTauriDesktop: vi.fn(),
    invoke: vi.fn(),
}));

vi.mock('@/utils/tauri', () => ({ isTauriDesktop: mocks.isTauriDesktop }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { getDesktopPlatform, startDesktopWindowDragging } from './desktopWindowUtils';

describe('desktop window platform detection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isTauriDesktop.mockReturnValue(true);
        mocks.invoke.mockResolvedValue(undefined);
    });

    it('detects macOS WebViews', () => {
        vi.stubGlobal('navigator', {
            platform: 'MacIntel',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        });

        expect(getDesktopPlatform()).toBe('macos');
    });

    it('detects Windows WebViews', () => {
        vi.stubGlobal('navigator', {
            platform: 'Win32',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        });

        expect(getDesktopPlatform()).toBe('windows');
    });

    it('does not add desktop chrome to a regular browser', () => {
        mocks.isTauriDesktop.mockReturnValue(false);

        expect(getDesktopPlatform()).toBeNull();
    });

    it('starts native dragging only inside Tauri', () => {
        startDesktopWindowDragging();
        expect(mocks.invoke).toHaveBeenCalledWith('start_desktop_window_dragging');

        mocks.invoke.mockClear();
        mocks.isTauriDesktop.mockReturnValue(false);
        startDesktopWindowDragging();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});

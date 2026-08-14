import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isTauriDesktop: vi.fn(),
    invoke: vi.fn(),
    toggleMaximize: vi.fn(),
}));

vi.mock('@/utils/tauri', () => ({ isTauriDesktop: mocks.isTauriDesktop }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ toggleMaximize: mocks.toggleMaximize }),
}));

import {
    getDesktopPlatform,
    handleDesktopTitleBarMouseDown,
    startDesktopWindowDragging,
} from './desktopWindowUtils';

describe('desktop window platform detection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isTauriDesktop.mockReturnValue(true);
        mocks.invoke.mockResolvedValue(undefined);
        mocks.toggleMaximize.mockResolvedValue(undefined);
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

    it('toggles maximize on the second title bar click', () => {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        handleDesktopTitleBarMouseDown({
            button: 0,
            detail: 2,
            preventDefault,
            stopPropagation,
            target: { closest: vi.fn().mockReturnValue(null) },
        });

        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
        expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('does not drag or maximize from interactive title bar content', () => {
        handleDesktopTitleBarMouseDown({
            button: 0,
            detail: 2,
            preventDefault: vi.fn(),
            target: { closest: vi.fn().mockReturnValue({}) },
        });

        expect(mocks.toggleMaximize).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('does not maximize an unauthenticated window', () => {
        handleDesktopTitleBarMouseDown({
            button: 0,
            detail: 2,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            target: { closest: vi.fn().mockReturnValue(null) },
        }, { allowMaximize: false });

        expect(mocks.toggleMaximize).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});

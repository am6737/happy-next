import { isTauriDesktop } from '@/utils/tauri';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type DesktopPlatform = 'macos' | 'windows';

export function getDesktopPlatform(): DesktopPlatform | null {
    if (!isTauriDesktop() || typeof navigator === 'undefined') {
        return null;
    }

    const navigatorWithUserAgentData = navigator as Navigator & {
        userAgentData?: { platform?: string };
    };
    const platform = [
        navigatorWithUserAgentData.userAgentData?.platform,
        navigator.platform,
        navigator.userAgent,
    ].filter(Boolean).join(' ');

    return /Mac|iPhone|iPad/i.test(platform) ? 'macos' : 'windows';
}

export function startDesktopWindowDragging(): void {
    if (!isTauriDesktop()) {
        return;
    }
    void invoke('start_desktop_window_dragging')
        .catch((error) => console.warn('Failed to start desktop window dragging:', error));
}

const DESKTOP_NO_DRAG_SELECTOR = '[data-desktop-no-drag], button, [role="button"], [tabindex], a, input, textarea, select';

export function toggleDesktopWindowMaximized(): void {
    if (!isTauriDesktop()) {
        return;
    }

    void getCurrentWindow().toggleMaximize()
        .catch((error) => console.warn('Failed to toggle desktop window maximized state:', error));
}

export function handleDesktopTitleBarMouseDown(
    event: any,
    options: { allowMaximize?: boolean } = {},
): void {
    if (!isTauriDesktop() || event.button !== 0) {
        return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest?.(DESKTOP_NO_DRAG_SELECTOR)) {
        return;
    }

    event.stopPropagation?.();
    event.preventDefault?.();

    if ((event.detail ?? 1) >= 2) {
        if (options.allowMaximize !== false) {
            toggleDesktopWindowMaximized();
        }
        return;
    }

    startDesktopWindowDragging();
}

import { isTauriDesktop } from '@/utils/tauri';
import { invoke } from '@tauri-apps/api/core';

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

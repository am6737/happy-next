import { isTauriDesktop } from '@/utils/tauri';

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

import { Platform } from 'react-native';
import { useSetting, useSettingMutable } from '@/sync/storage';
import { isMobileDeviceClass } from '@/utils/deviceClass';

// Platform.OS and the user agent never change at runtime, so the class is resolved once.
const isMobile = isMobileDeviceClass({
    platform: Platform.OS,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    maxTouchPoints: typeof navigator === 'undefined' ? null : navigator.maxTouchPoints,
});

/**
 * Compact session view is stored as two separate settings, one per platform class, because the two
 * layouts sit on very different screen widths. The settings UI looks the same on both — only the
 * field behind the switch differs, so each platform keeps its own value.
 *
 * Mobile covers the native iOS/Android app and every phone or tablet browser; desktop covers the
 * Tauri desktop app and desktop browsers.
 */
export function useCompactSessionView(): boolean {
    const mobile = useSetting('compactSessionViewMobile');
    const desktop = useSetting('compactSessionViewDesktop');
    return isMobile ? mobile : desktop;
}

export function useCompactSessionViewMutable(): [boolean, (value: boolean) => void] {
    const [mobile, setMobile] = useSettingMutable('compactSessionViewMobile');
    const [desktop, setDesktop] = useSettingMutable('compactSessionViewDesktop');
    return isMobile ? [mobile, setMobile] : [desktop, setDesktop];
}

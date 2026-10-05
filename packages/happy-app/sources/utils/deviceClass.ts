// Pure device-class detection with no React Native or other runtime dependency, so it can be
// unit tested. The app splits a handful of preferences between the mobile and desktop layouts;
// see isMobileDeviceClass.

const PHONE_BROWSER_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|BlackBerry|webOS|Opera Mini|Opera Mobi/i;
// iPads and Android tablets. The iPad case covers the pre-iPadOS-13 user agent; newer iPads are
// handled by the Macintosh check below. Android tablets are the ones that omit "Mobile".
const TABLET_BROWSER_UA = /iPad|Android/i;
// iPadOS 13+ Safari reports a Macintosh user agent, indistinguishable from a Mac except for the
// touch points — no Mac reports more than one.
const MASKED_IPAD_UA = /Macintosh/i;

/** True for a phone or tablet browser user agent; false for desktop browsers. */
export function isMobileBrowserUserAgent(userAgent: string, maxTouchPoints?: number | null): boolean {
    if (PHONE_BROWSER_UA.test(userAgent) || TABLET_BROWSER_UA.test(userAgent)) {
        return true;
    }
    return MASKED_IPAD_UA.test(userAgent) && (maxTouchPoints ?? 0) > 1;
}

/**
 * Mobile means the native iOS/Android app and every phone or tablet browser. Desktop means the
 * Tauri desktop app and desktop browsers. Platform names match React Native's Platform.OS.
 */
export function isMobileDeviceClass(params: {
    platform: string;
    userAgent?: string | null;
    maxTouchPoints?: number | null;
}): boolean {
    if (params.platform !== 'web') {
        return true;
    }
    return params.userAgent ? isMobileBrowserUserAgent(params.userAgent, params.maxTouchPoints) : false;
}

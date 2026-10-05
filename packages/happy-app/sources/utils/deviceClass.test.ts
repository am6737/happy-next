import { describe, it, expect } from 'vitest';
import { isMobileDeviceClass, isMobileBrowserUserAgent } from './deviceClass';

const DESKTOP_UA = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const PHONE_UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    androidChrome: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    androidFirefox: 'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/109.0 Firefox/119.0',
};

const TABLET_UA = {
    ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
    // iPadOS 13+ reports a Macintosh user agent; only the touch points give it away.
    ipadModern: DESKTOP_UA.mac,
    androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('isMobileBrowserUserAgent', () => {
    it('should detect phone user agents', () => {
        expect(isMobileBrowserUserAgent(PHONE_UA.iphone)).toBe(true);
        expect(isMobileBrowserUserAgent(PHONE_UA.androidChrome)).toBe(true);
        expect(isMobileBrowserUserAgent(PHONE_UA.androidFirefox)).toBe(true);
    });

    it('should detect tablet user agents', () => {
        expect(isMobileBrowserUserAgent(TABLET_UA.ipadLegacy)).toBe(true);
        expect(isMobileBrowserUserAgent(TABLET_UA.androidTablet)).toBe(true);
        expect(isMobileBrowserUserAgent(TABLET_UA.ipadModern, 5)).toBe(true);
    });

    it('should not mistake a real Mac for a modern iPad', () => {
        expect(isMobileBrowserUserAgent(DESKTOP_UA.mac, 0)).toBe(false);
        expect(isMobileBrowserUserAgent(DESKTOP_UA.mac, undefined)).toBe(false);
    });

    it('should not detect desktop user agents', () => {
        expect(isMobileBrowserUserAgent(DESKTOP_UA.windows)).toBe(false);
        expect(isMobileBrowserUserAgent(DESKTOP_UA.linux)).toBe(false);
    });

    it('should not treat a touchscreen desktop as mobile', () => {
        expect(isMobileBrowserUserAgent(DESKTOP_UA.windows, 10)).toBe(false);
    });
});

describe('isMobileDeviceClass', () => {
    it('should treat the native app as mobile on every platform', () => {
        expect(isMobileDeviceClass({ platform: 'ios' })).toBe(true);
        expect(isMobileDeviceClass({ platform: 'android' })).toBe(true);
    });

    it('should treat phone and tablet browsers on web as mobile', () => {
        expect(isMobileDeviceClass({ platform: 'web', userAgent: PHONE_UA.iphone })).toBe(true);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: PHONE_UA.androidChrome })).toBe(true);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: TABLET_UA.ipadLegacy })).toBe(true);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: TABLET_UA.androidTablet })).toBe(true);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: TABLET_UA.ipadModern, maxTouchPoints: 5 })).toBe(true);
    });

    it('should treat desktop browsers and unknown web runtimes as desktop', () => {
        expect(isMobileDeviceClass({ platform: 'web', userAgent: DESKTOP_UA.mac, maxTouchPoints: 0 })).toBe(false);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: DESKTOP_UA.windows })).toBe(false);
        expect(isMobileDeviceClass({ platform: 'web', userAgent: null })).toBe(false);
        expect(isMobileDeviceClass({ platform: 'web' })).toBe(false);
    });
});

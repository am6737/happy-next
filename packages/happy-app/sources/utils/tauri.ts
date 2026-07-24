import { invoke } from '@tauri-apps/api/core';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isAllowedExternalUrl(url: string): boolean {
    try {
        return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
    } catch {
        return false;
    }
}

export function isTauriDesktop(): boolean {
    return Platform.OS === 'web'
        && typeof window !== 'undefined'
        && (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

export async function openDesktopHtmlPreviewInBrowser(html: string): Promise<void> {
    if (!isTauriDesktop()) {
        throw new Error('Desktop HTML previews are only available in the Tauri app');
    }
    await invoke('open_desktop_html_preview', { html });
}

export async function openExternalUrl(
    url: string,
    options: { nativeBrowser?: 'system' | 'in-app' } = {},
): Promise<void> {
    if (!isAllowedExternalUrl(url)) {
        console.warn('Blocked unsupported external URL');
        return;
    }

    if (isTauriDesktop()) {
        await invoke('plugin:opener|open_url', { url, with: null });
        return;
    }

    if (Platform.OS === 'web') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    if (options.nativeBrowser === 'in-app') {
        await WebBrowser.openBrowserAsync(url);
        return;
    }

    await Linking.openURL(url);
}

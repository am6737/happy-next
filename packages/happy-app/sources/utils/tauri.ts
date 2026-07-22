import { invoke } from '@tauri-apps/api/core';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

export function isTauriDesktop(): boolean {
    return Platform.OS === 'web'
        && typeof window !== 'undefined'
        && (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

export async function openExternalUrl(
    url: string,
    options: { nativeBrowser?: 'system' | 'in-app' } = {},
): Promise<void> {
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

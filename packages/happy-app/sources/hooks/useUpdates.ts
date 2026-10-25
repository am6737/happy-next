import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

// OTA updates are checked from the app root (startUpdateChecks in app/_layout.tsx) at launch and
// whenever the app comes back to the foreground, whatever screen is open; a downloaded update is
// shared here so the banner (UpdateBanner) shows it and applies it on tap.
let updateAvailable = false;
let isChecking = false;
const listeners = new Set<() => void>();

function setUpdateAvailable(value: boolean) {
    updateAvailable = value;
    listeners.forEach((listener) => listener());
}

async function checkForUpdates() {
    if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled || isChecking || updateAvailable) {
        return;
    }
    isChecking = true;
    try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            setUpdateAvailable(true);
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    } finally {
        isChecking = false;
    }
}

/** Checks now and on every return to the foreground; returns the cleanup */
export function startUpdateChecks() {
    checkForUpdates();
    const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
            checkForUpdates();
        }
    });
    return () => subscription.remove();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

async function reloadApp() {
    if (Platform.OS === 'web') {
        window.location.reload();
    } else {
        try {
            await Updates.reloadAsync();
        } catch (error) {
            console.error('Error reloading app:', error);
        }
    }
}

export function useUpdates() {
    return {
        updateAvailable: useSyncExternalStore(subscribe, () => updateAvailable),
        reloadApp,
    };
}

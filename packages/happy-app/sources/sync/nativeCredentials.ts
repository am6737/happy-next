import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type HappyWatchModule = {
    setCredentials(token: string, secret: string, serverUrl: string): void;
    clearCredentials(): void;
};

// Absent on Android and the web, and in an iOS binary built before the module was added
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<HappyWatchModule>('HappyWatch') : null;

/**
 * Gives the native side the account's credentials and server, which notification actions (allow,
 * deny, reply) and the Apple Watch app use to talk to the server without the app.
 */
export function setNativeCredentials(token: string, secret: string, serverUrl: string): void {
    native?.setCredentials(token, secret, serverUrl);
}

export function clearNativeCredentials(): void {
    native?.clearCredentials();
}

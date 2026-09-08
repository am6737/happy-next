import { measureLogoutStage } from '@/auth/logoutTiming';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { deletePushToken } from './apiPush';
import {
    getStoredDooPushRegistrationToken,
    invalidateDooPushRegistration,
} from './doopushRegistrationState';
import {
    clearStoredExpoFallbackToken,
    getStoredExpoFallbackToken,
} from './expoPushMigrationState';

const LOGOUT_UNREGISTER_TIMEOUT_MS = 3_000;

async function waitWithTimeout(
    task: Promise<void>,
    timeoutMs: number,
    onTimeout?: () => void,
): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            task,
            new Promise<void>((_, reject) => {
                timeout = setTimeout(() => {
                    onTimeout?.();
                    reject(new Error('Timed out while unregistering push tokens'));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

export async function unregisterCurrentPushToken(
    credentials: AuthCredentials,
    timeoutMs: number = LOGOUT_UNREGISTER_TIMEOUT_MS,
): Promise<void> {
    if (Platform.OS === 'web') {
        return;
    }

    const storedExpoToken = getStoredExpoFallbackToken();
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(`[logout] expo-token-source: ${storedExpoToken ? 'cached' : 'lookup'}`);
    }
    const controller = new AbortController();
    const unregister = (async () => {
        const removals: Promise<void>[] = [];
        const dooPushToken = getStoredDooPushRegistrationToken();
        if (dooPushToken) {
            removals.push(measureLogoutStage('delete-doopush-binding', () =>
                deletePushToken(credentials, dooPushToken, controller.signal)));
        }
        let expoTokenToRemove = storedExpoToken;
        if (!expoTokenToRemove) {
            const { status } = await measureLogoutStage('notification-permissions', () =>
                Notifications.getPermissionsAsync());
            if (status === 'granted') {
                const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
                expoTokenToRemove = (await measureLogoutStage('get-expo-token', () =>
                    Notifications.getExpoPushTokenAsync({ projectId }))).data;
            }
        }
        if (expoTokenToRemove && expoTokenToRemove !== dooPushToken) {
            const expoToken = expoTokenToRemove;
            removals.push(measureLogoutStage('delete-expo-binding', () =>
                deletePushToken(credentials, expoToken, controller.signal)));
        }
        const results = await Promise.allSettled(removals);
        const failure = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failure) {
            throw failure.reason;
        }
    })();
    try {
        await measureLogoutStage('remote-unregister', () => waitWithTimeout(
            unregister,
            timeoutMs,
            () => controller.abort(),
        ));
    } finally {
        controller.abort();
        try {
            // Native unregistration (including Android's FCM deletion) may hang
            // independently of server cleanup. Do not let it hold up logout.
            await measureLogoutStage('native-unregister', () =>
                waitWithTimeout(Notifications.unregisterForNotificationsAsync(), timeoutMs));
            invalidateDooPushRegistration();
            if (storedExpoToken) {
                clearStoredExpoFallbackToken(storedExpoToken);
            }
        } catch {
            // Keep the snapshot reusable when native invalidation failed or timed
            // out. A late completion must not clear a newer registration snapshot.
        }
    }
}

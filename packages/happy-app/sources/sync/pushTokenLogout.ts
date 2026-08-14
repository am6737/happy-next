import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { deletePushToken } from './apiPush';

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
            new Promise<void>((resolve) => {
                timeout = setTimeout(() => {
                    onTimeout?.();
                    resolve();
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

    const controller = new AbortController();
    const unregister = (async () => {
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
        await deletePushToken(credentials, expoToken.data, controller.signal);
    })();
    try {
        await waitWithTimeout(
            unregister.catch(() => {}),
            timeoutMs,
            () => controller.abort(),
        );
    } finally {
        controller.abort();
        await Notifications.unregisterForNotificationsAsync().catch(() => {});
    }
}

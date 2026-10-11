import React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { getNotificationChannelId } from '@/utils/notificationData';

/** Route the daemon's channel push payload on warm opens and Expo cold starts. */
export function useChannelNotifications(authenticated: boolean) {
    const router = useRouter();
    const lastOpened = React.useRef<{ id: string; at: number } | null>(null);
    React.useEffect(() => {
        if (!authenticated || Platform.OS === 'web') return;
        let mounted = true;
        const subscriptions: Array<{ remove(): void }> = [];
        const open = (data: unknown) => {
            const id = getNotificationChannelId(data);
            if (!mounted || !id) return;
            const now = Date.now();
            if (lastOpened.current?.id === id && now - lastOpened.current.at < 1000) return;
            lastOpened.current = { id, at: now };
            router.navigate({ pathname: '/channels/[id]', params: { id } });
        };
        subscriptions.push(Notifications.addNotificationResponseReceivedListener(response => open(response.notification.request.content.data)));
        void Notifications.getLastNotificationResponseAsync().then(response => {
            if (response && mounted && getNotificationChannelId(response.notification.request.content.data)) {
                open(response.notification.request.content.data);
                void Notifications.clearLastNotificationResponseAsync();
            }
        }).catch(() => {});
        void import('doopush-react-native-sdk').then(({ DooPush }) => {
            if (!mounted) return;
            subscriptions.push(DooPush.addNotificationClickListener(message => open(message.data)), DooPush.addNotificationOpenListener(message => open(message.data)));
        }).catch(() => {});
        return () => { mounted = false; subscriptions.forEach(subscription => subscription.remove()); };
    }, [authenticated, router]);
}

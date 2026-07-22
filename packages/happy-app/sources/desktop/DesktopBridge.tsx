import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { usePathname, useRouter } from 'expo-router';

import { storage, useLocalSetting } from '@/sync/storage';
import { getSessionName } from '@/utils/sessionUtils';
import { isTauriDesktop } from '@/utils/tauri';
import { subscribeToDesktopMessages } from './desktopEvents';
import { messagePreview, notificationId, sessionIdFromPath } from './desktopNotificationUtils';

const DESKTOP_SHORTCUT = 'CommandOrControl+Shift+H';

export function DesktopBridge() {
    const router = useRouter();
    const pathname = usePathname();
    const closeToTray = useLocalSetting('desktopCloseToTray');
    const notificationsEnabled = useLocalSetting('desktopNotificationsEnabled');
    const autostartEnabled = useLocalSetting('desktopAutostartEnabled');
    const globalShortcutEnabled = useLocalSetting('desktopGlobalShortcutEnabled');
    const hideNotificationsWhenActive = useLocalSetting('hideNotificationsWhenActive');
    const hideSessionNotificationsWhenActive = useLocalSetting('hideSessionNotificationsWhenActive');
    const currentSessionId = React.useMemo(() => sessionIdFromPath(pathname), [pathname]);

    const currentSessionIdRef = React.useRef(currentSessionId);
    const windowFocusedRef = React.useRef(true);
    const unreadBySessionRef = React.useRef(new Map<string, Set<string>>());
    const seenMessageIdsRef = React.useRef(new Set<string>());
    const notificationTimersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const notificationPayloadRef = React.useRef(new Map<string, { title: string; body: string }>());

    React.useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
        if (currentSessionId && windowFocusedRef.current) {
            unreadBySessionRef.current.delete(currentSessionId);
            const count = [...unreadBySessionRef.current.values()].reduce((sum, ids) => sum + ids.size, 0);
            void invoke('set_desktop_unread_count', { count });
        }
    }, [currentSessionId]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        void invoke('set_close_to_tray', { enabled: closeToTray });
    }, [closeToTray]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let cancelled = false;
        void import('@tauri-apps/plugin-autostart').then(async ({ disable, enable }) => {
            if (cancelled) {
                return;
            }
            try {
                if (autostartEnabled) {
                    await enable();
                } else {
                    await disable();
                }
            } catch (error) {
                console.warn('Failed to update desktop autostart:', error);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [autostartEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let active = true;
        void import('@tauri-apps/plugin-global-shortcut').then(async ({ isRegistered, register, unregister }) => {
            try {
                const registered = await isRegistered(DESKTOP_SHORTCUT);
                if (!active) {
                    return;
                }
                if (globalShortcutEnabled && !registered) {
                    await register(DESKTOP_SHORTCUT, (event) => {
                        if (event.state === 'Pressed') {
                            void invoke('toggle_desktop_window');
                        }
                    });
                } else if (!globalShortcutEnabled && registered) {
                    await unregister(DESKTOP_SHORTCUT);
                }
            } catch (error) {
                console.warn('Failed to update desktop global shortcut:', error);
            }
        });
        return () => {
            active = false;
        };
    }, [globalShortcutEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop() || !notificationsEnabled) {
            return;
        }
        void import('@tauri-apps/plugin-notification').then(async ({ isPermissionGranted, requestPermission }) => {
            try {
                if (!(await isPermissionGranted())) {
                    await requestPermission();
                }
            } catch (error) {
                console.warn('Failed to request desktop notification permission:', error);
            }
        });
    }, [notificationsEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let unlistenFocus: (() => void) | undefined;
        let notificationListener: { unregister: () => void } | undefined;
        let cancelled = false;

        void getCurrentWindow().isFocused().then((focused) => {
            windowFocusedRef.current = focused;
        });
        void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            windowFocusedRef.current = focused;
            if (focused && currentSessionIdRef.current) {
                unreadBySessionRef.current.delete(currentSessionIdRef.current);
                const count = [...unreadBySessionRef.current.values()].reduce((sum, ids) => sum + ids.size, 0);
                void invoke('set_desktop_unread_count', { count });
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenFocus = unlisten;
            }
        });

        void import('@tauri-apps/plugin-notification').then(async ({ onAction }) => {
            const listener = await onAction((notification) => {
                const sessionId = notification.extra?.sessionId;
                if (typeof sessionId === 'string') {
                    void invoke('show_desktop_window');
                    router.push(`/session/${encodeURIComponent(sessionId)}`);
                }
            });
            if (cancelled) {
                listener.unregister();
            } else {
                notificationListener = listener;
            }
        }).catch((error) => console.warn('Failed to register notification action listener:', error));

        const unsubscribeMessages = subscribeToDesktopMessages(({ sessionId, messages }) => {
            const state = storage.getState();
            const currentUserId = state.profile.id || null;
            const relevant = messages.filter((message) => {
                if (seenMessageIdsRef.current.has(message.id)) {
                    return false;
                }
                seenMessageIdsRef.current.add(message.id);
                if (seenMessageIdsRef.current.size > 5000) {
                    seenMessageIdsRef.current.clear();
                    seenMessageIdsRef.current.add(message.id);
                }
                return messagePreview(message, currentUserId) !== null;
            });
            if (relevant.length === 0) {
                return;
            }

            const isCurrentAndFocused = windowFocusedRef.current && currentSessionIdRef.current === sessionId;
            if (!isCurrentAndFocused) {
                const ids = unreadBySessionRef.current.get(sessionId) ?? new Set<string>();
                for (const message of relevant) {
                    ids.add(message.id);
                }
                unreadBySessionRef.current.set(sessionId, ids);
                const count = [...unreadBySessionRef.current.values()].reduce((sum, value) => sum + value.size, 0);
                void invoke('set_desktop_unread_count', { count });
            }

            const shouldNotify = notificationsEnabled
                && !isCurrentAndFocused
                && !(windowFocusedRef.current && hideNotificationsWhenActive)
                && !(windowFocusedRef.current && hideSessionNotificationsWhenActive && currentSessionIdRef.current === sessionId);
            if (!shouldNotify) {
                return;
            }

            const session = state.sessions[sessionId] ?? state.sharedSessions[sessionId];
            const title = session ? getSessionName(session) : 'Happy Next';
            const body = messagePreview(relevant[relevant.length - 1], currentUserId) ?? 'New message';
            notificationPayloadRef.current.set(sessionId, { title, body });

            const existingTimer = notificationTimersRef.current.get(sessionId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            const timer = setTimeout(() => {
                notificationTimersRef.current.delete(sessionId);
                const payload = notificationPayloadRef.current.get(sessionId);
                notificationPayloadRef.current.delete(sessionId);
                if (!payload) {
                    return;
                }
                void import('@tauri-apps/plugin-notification').then(async ({ isPermissionGranted, sendNotification }) => {
                    if (await isPermissionGranted()) {
                        sendNotification({
                            id: notificationId(sessionId),
                            title: payload.title,
                            body: payload.body.slice(0, 240),
                            group: sessionId,
                            autoCancel: true,
                            extra: { sessionId },
                        });
                    }
                }).catch((error) => console.warn('Failed to send desktop notification:', error));
            }, 500);
            notificationTimersRef.current.set(sessionId, timer);
        });

        return () => {
            cancelled = true;
            unsubscribeMessages();
            unlistenFocus?.();
            notificationListener?.unregister();
            for (const timer of notificationTimersRef.current.values()) {
                clearTimeout(timer);
            }
            notificationTimersRef.current.clear();
        };
    }, [hideNotificationsWhenActive, hideSessionNotificationsWhenActive, notificationsEnabled, router]);

    return null;
}

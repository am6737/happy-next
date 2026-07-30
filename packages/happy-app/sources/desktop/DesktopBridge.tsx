import * as React from 'react';
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { usePathname, useRouter } from 'expo-router';

import { storage, useLocalSetting } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessionUtils';
import { isTauriDesktop } from '@/utils/tauri';
import { subscribeToDesktopMessages, subscribeToDesktopPermissionRequests } from './desktopEvents';
import { subscribeToDesktopAuthentication } from './desktopAuthEvents';
import {
    agentMessagePreview,
    isReadyEvent,
    notificationId,
    otherUserMessagePreview,
    sessionIdFromPath,
} from './desktopNotificationUtils';
import { truncateMessagePreviewText } from '@/utils/messagePreviewText';
import {
    prepareDesktopUpdate,
} from './desktopUpdater';

const DESKTOP_SHORTCUT = 'CommandOrControl+Shift+H';
const IS_MACOS_DESKTOP = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

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
    const seenPermissionRequestIdsRef = React.useRef(new Set<string>());
    const latestAgentPreviewBySessionRef = React.useRef(new Map<string, string>());
    const notificationTimersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const notificationPayloadRef = React.useRef(new Map<string, { title: string; body: string }>());
    const notificationSessionsRef = React.useRef(new Map<number, string>());
    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let cancelled = false;
        let unlistenMenu: (() => void) | undefined;

        const prepareUpdate = async (interactive = false) => {
            const result = await prepareDesktopUpdate();
            if (interactive && result.phase === 'upToDate') {
                Modal.alert(t('desktopUpdate.title'), t('desktopUpdate.upToDate'));
                return;
            }
            if (interactive && result.phase === 'unsupported') {
                Modal.alert(t('desktopUpdate.title'), t('desktopUpdate.productionOnly'));
                return;
            }
            if (interactive && result.phase === 'error') {
                Modal.alert(t('desktopUpdate.failed'), t('desktopUpdate.tryAgain'));
            }
        };

        const timer = setTimeout(() => {
            void prepareUpdate();
        }, 12_000);

        void listen<{ action: string }>('desktop-menu-action', ({ payload }) => {
            if (payload.action === 'softwareUpdate') {
                void prepareUpdate(true);
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenMenu = unlisten;
            }
        }).catch((error) => console.warn('Failed to register software update menu listener:', error));

        return () => {
            cancelled = true;
            clearTimeout(timer);
            unlistenMenu?.();
        };
    }, [router]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        return subscribeToDesktopAuthentication((authenticated) => {
            if (authenticated) {
                return;
            }
            unreadBySessionRef.current.clear();
            seenMessageIdsRef.current.clear();
            seenPermissionRequestIdsRef.current.clear();
            latestAgentPreviewBySessionRef.current.clear();
            notificationPayloadRef.current.clear();
            notificationSessionsRef.current.clear();
            for (const timer of notificationTimersRef.current.values()) {
                clearTimeout(timer);
            }
            notificationTimersRef.current.clear();
            void invoke('set_desktop_unread_count', { count: 0 });
        });
    }, []);

    React.useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
        if (isTauriDesktop() && currentSessionId && windowFocusedRef.current) {
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
        if (IS_MACOS_DESKTOP) {
            void invoke('plugin:notifications|request_permission')
                .catch((error) => console.warn('Failed to request native macOS notification permission:', error));
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
        let unlistenNotificationClick: (() => void) | undefined;
        let nativeNotificationClickListener: PluginListener | undefined;
        let cancelled = false;

        const openNotificationSession = (sessionId: string) => {
            const pendingTimer = notificationTimersRef.current.get(sessionId);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                notificationTimersRef.current.delete(sessionId);
            }
            notificationPayloadRef.current.delete(sessionId);
            notificationSessionsRef.current.delete(notificationId(sessionId));

            unreadBySessionRef.current.delete(sessionId);
            const count = [...unreadBySessionRef.current.values()].reduce((sum, ids) => sum + ids.size, 0);
            void invoke('set_desktop_unread_count', { count });

            currentSessionIdRef.current = sessionId;
            void invoke('show_desktop_window')
                .catch((error) => console.warn('Failed to show desktop window from notification:', error));
            router.replace(`/session/${encodeURIComponent(sessionId)}`);
        };

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

        void listen<{ sessionId: string }>('desktop-notification-clicked', ({ payload }) => {
            if (typeof payload.sessionId === 'string') {
                openNotificationSession(payload.sessionId);
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenNotificationClick = unlisten;
            }
        }).catch((error) => console.warn('Failed to register notification click listener:', error));

        if (IS_MACOS_DESKTOP) {
            void addPluginListener<{ id: number }>('notifications', 'notificationClicked', (notification) => {
                const state = storage.getState();
                const sessionId = notificationSessionsRef.current.get(notification.id)
                    ?? [...Object.keys(state.sessions), ...Object.keys(state.sharedSessions)]
                        .find((candidate) => notificationId(candidate) === notification.id);
                if (sessionId) {
                    openNotificationSession(sessionId);
                }
            }).then(async (listener) => {
                if (cancelled) {
                    await listener.unregister();
                    return;
                }
                nativeNotificationClickListener = listener;
                await invoke('plugin:notifications|set_click_listener_active', { active: true });
            }).catch((error) => console.warn('Failed to register native macOS notification click listener:', error));
        }

        const unsubscribeMessages = subscribeToDesktopMessages(({ sessionId, messages }) => {
            const state = storage.getState();
            const currentUserId = state.profile.id || null;
            const unreadMessageIds: string[] = [];
            let notificationBody: string | null = null;
            let completionMessageId: string | null = null;
            let completionShouldNotify = false;

            for (const message of messages) {
                if (seenMessageIdsRef.current.has(message.id)) {
                    continue;
                }
                seenMessageIdsRef.current.add(message.id);
                if (seenMessageIdsRef.current.size > 5000) {
                    seenMessageIdsRef.current.clear();
                    seenMessageIdsRef.current.add(message.id);
                }

                const agentPreview = agentMessagePreview(message);
                if (agentPreview) {
                    latestAgentPreviewBySessionRef.current.set(sessionId, agentPreview);
                    unreadMessageIds.push(message.id);
                    continue;
                }

                const otherUserPreview = otherUserMessagePreview(message, currentUserId);
                if (otherUserPreview) {
                    notificationBody = otherUserPreview;
                    unreadMessageIds.push(message.id);
                    continue;
                }

                if (isReadyEvent(message)) {
                    completionMessageId = message.id;
                }
            }

            if (completionMessageId) {
                const hasActiveDelegatedWork = Object.keys(state.orchestratorActivity[sessionId] ?? {}).length > 0;
                if (!hasActiveDelegatedWork) {
                    completionShouldNotify = true;
                    notificationBody = latestAgentPreviewBySessionRef.current.get(sessionId)
                        ?? 'Your agent is waiting for your command';
                    latestAgentPreviewBySessionRef.current.delete(sessionId);
                }
            }

            const isCurrentAndFocused = windowFocusedRef.current && currentSessionIdRef.current === sessionId;
            if (completionMessageId
                && completionShouldNotify
                && !isCurrentAndFocused
                && unreadMessageIds.length === 0
                && (unreadBySessionRef.current.get(sessionId)?.size ?? 0) === 0) {
                unreadMessageIds.push(completionMessageId);
            }
            if (!isCurrentAndFocused && unreadMessageIds.length > 0) {
                const ids = unreadBySessionRef.current.get(sessionId) ?? new Set<string>();
                for (const messageId of unreadMessageIds) {
                    ids.add(messageId);
                }
                unreadBySessionRef.current.set(sessionId, ids);
                const count = [...unreadBySessionRef.current.values()].reduce((sum, value) => sum + value.size, 0);
                void invoke('set_desktop_unread_count', { count });
            }

            const shouldNotify = notificationsEnabled
                && !isCurrentAndFocused
                && !(windowFocusedRef.current && hideNotificationsWhenActive)
                && !(windowFocusedRef.current && hideSessionNotificationsWhenActive && currentSessionIdRef.current === sessionId);
            if (!notificationBody || !shouldNotify) {
                return;
            }

            const session = state.sessions[sessionId] ?? state.sharedSessions[sessionId];
            const title = session ? getSessionName(session) : 'Happy Next';
            notificationPayloadRef.current.set(sessionId, { title, body: notificationBody });

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
                const sendDesktopNotification = async () => {
                    const id = notificationId(sessionId);
                    notificationSessionsRef.current.set(id, sessionId);
                    await invoke('show_desktop_notification', {
                        notificationId: id,
                        title: payload.title,
                        body: truncateMessagePreviewText(payload.body, 240),
                        sessionId,
                    });
                };

                // The native command owns permission handling. Keeping the permission
                // check here caused notifications to be silently skipped when WebKit's
                // platform detection or the separate official plugin disagreed with the
                // native notification backend.
                void sendDesktopNotification()
                    .catch((error) => console.warn('Failed to send desktop notification:', error));
            }, 500);
            notificationTimersRef.current.set(sessionId, timer);
        });

        const unsubscribePermissionRequests = subscribeToDesktopPermissionRequests(({ sessionId, requestId, toolName }) => {
            if (seenPermissionRequestIdsRef.current.has(requestId)) {
                return;
            }
            seenPermissionRequestIdsRef.current.add(requestId);
            if (seenPermissionRequestIdsRef.current.size > 5000) {
                seenPermissionRequestIdsRef.current.clear();
                seenPermissionRequestIdsRef.current.add(requestId);
            }

            const isCurrentAndFocused = windowFocusedRef.current && currentSessionIdRef.current === sessionId;
            if (!isCurrentAndFocused) {
                const ids = unreadBySessionRef.current.get(sessionId) ?? new Set<string>();
                ids.add(`permission:${requestId}`);
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

            const state = storage.getState();
            const session = state.sessions[sessionId] ?? state.sharedSessions[sessionId];
            const title = session ? getSessionName(session) : 'Permission Request';
            const agentName = session?.metadata?.flavor === 'codex'
                ? 'Codex'
                : session?.metadata?.flavor === 'gemini'
                    ? 'Gemini'
                    : 'Claude';
            const id = notificationId(sessionId);
            notificationSessionsRef.current.set(id, sessionId);
            void invoke('show_desktop_notification', {
                notificationId: id,
                title,
                body: `${agentName} wants to ${toolName}`,
                sessionId,
            }).catch((error) => console.warn('Failed to send desktop permission notification:', error));
        });

        return () => {
            cancelled = true;
            unsubscribeMessages();
            unsubscribePermissionRequests();
            unlistenFocus?.();
            unlistenNotificationClick?.();
            if (nativeNotificationClickListener) {
                void nativeNotificationClickListener.unregister();
                void invoke('plugin:notifications|set_click_listener_active', { active: false });
            }
            for (const timer of notificationTimersRef.current.values()) {
                clearTimeout(timer);
            }
            notificationTimersRef.current.clear();
        };
    }, [hideNotificationsWhenActive, hideSessionNotificationsWhenActive, notificationsEnabled, router]);

    return null;
}

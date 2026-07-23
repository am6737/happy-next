import { useEffect } from 'react';
import { Platform } from 'react-native';

import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { desktopKeyboardShortcutAction, type DesktopKeyboardShortcutAction } from '@/desktop/desktopKeyboardShortcuts';
import { isTauriDesktop } from '@/utils/tauri';

type KeyboardShortcutHandlers = {
    enabled: boolean;
    onSearch: () => void;
    onNewSession: () => void;
    onSettings: () => void;
    onSessions: () => void;
    onInbox: () => void;
    onDootask: () => void;
    onBack: () => void;
    onForward: () => void;
    onEscape?: () => void;
};

export function useGlobalKeyboard(handlers: KeyboardShortcutHandlers) {
    useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) {
                return;
            }

            const desktop = isTauriDesktop();
            const key = event.key.toLowerCase();

            // Keep the command-palette shortcut available in regular browsers.
            // The remaining shortcuts are desktop-app only.
            if (!desktop) {
                if ((event.metaKey || event.ctrlKey) && key === 'k') {
                    event.preventDefault();
                    event.stopPropagation();
                    handlers.onSearch();
                }
                return;
            }

            if (event.key === 'Escape' && handlers.onEscape) {
                event.preventDefault();
                event.stopPropagation();
                handlers.onEscape();
                return;
            }

            if (!handlers.enabled) {
                return;
            }

            const desktopPlatform = getDesktopPlatform();
            if (!desktopPlatform) {
                return;
            }
            const shortcut = desktopKeyboardShortcutAction(event, desktopPlatform);
            if (!shortcut) {
                return;
            }

            const actions: Record<DesktopKeyboardShortcutAction, () => void> = {
                search: handlers.onSearch,
                newSession: handlers.onNewSession,
                settings: handlers.onSettings,
                sessions: handlers.onSessions,
                inbox: handlers.onInbox,
                dootask: handlers.onDootask,
                back: handlers.onBack,
                forward: handlers.onForward,
            };

            event.preventDefault();
            event.stopPropagation();
            actions[shortcut]();
        };

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [handlers]);
}

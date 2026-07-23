import { invoke } from '@tauri-apps/api/core';
import * as React from 'react';

import { useAuth } from '@/auth/AuthContext';
import { useLocalSetting } from '@/sync/storage';
import { isTauriDesktop } from '@/utils/tauri';
import { publishDesktopAuthentication } from './desktopAuthEvents';

export function DesktopAuthWindowSync() {
    const { isAuthenticated } = useAuth();
    const themePreference = useLocalSetting('themePreference');

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }

        publishDesktopAuthentication(isAuthenticated);
        void invoke('sync_desktop_bootstrap_state', {
            authenticated: isAuthenticated,
            themePreference,
        })
            .catch((error) => {
                console.warn('Failed to update the desktop bootstrap state:', error);
            });
    }, [isAuthenticated, themePreference]);

    return null;
}

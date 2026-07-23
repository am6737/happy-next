import { invoke } from '@tauri-apps/api/core';
import * as React from 'react';

import { useAuth } from '@/auth/AuthContext';
import { isTauriDesktop } from '@/utils/tauri';

export function DesktopAuthWindowSync() {
    const { isAuthenticated } = useAuth();

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }

        void invoke('set_desktop_authenticated_window', { authenticated: isAuthenticated })
            .catch((error) => {
                console.warn('Failed to update the desktop window mode:', error);
            });
    }, [isAuthenticated]);

    return null;
}

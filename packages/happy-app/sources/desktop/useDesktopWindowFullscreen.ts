import { getCurrentWindow } from '@tauri-apps/api/window';
import * as React from 'react';

import { isTauriDesktop } from '@/utils/tauri';

export function useDesktopWindowFullscreen(enabled: boolean): boolean {
    const [fullscreen, setFullscreen] = React.useState(false);

    React.useEffect(() => {
        if (!enabled || !isTauriDesktop()) {
            setFullscreen(false);
            return;
        }

        const window = getCurrentWindow();
        let mounted = true;
        let unlisten: (() => void) | undefined;

        const updateFullscreen = async () => {
            try {
                const value = await window.isFullscreen();
                if (mounted) {
                    setFullscreen(value);
                }
            } catch (error) {
                console.warn('Failed to read desktop fullscreen state:', error);
            }
        };

        void updateFullscreen();
        void window.onResized(() => {
            void updateFullscreen();
        }).then((cleanup) => {
            unlisten = cleanup;
        }).catch((error) => console.warn('Failed to observe desktop fullscreen state:', error));

        return () => {
            mounted = false;
            unlisten?.();
        };
    }, [enabled]);

    return fullscreen;
}

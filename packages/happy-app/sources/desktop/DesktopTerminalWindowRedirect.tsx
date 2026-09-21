import * as React from 'react';
import { useRouter } from 'expo-router';
import { listen } from '@tauri-apps/api/event';
import { isTerminalWindow, takeDesktopTerminalFocus, type TerminalFocus } from './desktopWindowUtils';

/** How long to let auth and sync settle before the terminal route is reachable. */
const BOOT_DELAY_MS = 500;

/**
 * Whether this window has already been sent to the workspace.
 *
 * A terminal window is created at the app root and redirected once, on the boot
 * this component times; everything after that is a tab switch in a screen that
 * is already up. Module scope rather than a ref because the redirect that
 * matters outlives no render — the window lives on one route for its whole life.
 */
let reachedWorkspace = false;

/**
 * Sends the terminal window to its workspace, and to the tab it was opened for.
 *
 * The window is created at the app root, so something has to translate its
 * purpose into a route once the app has booted. Renders nothing, and does
 * nothing in any window that is not the terminal window.
 *
 * A request reaches it two ways: parked in the desktop shell for a window that
 * is still starting up, or pushed as an event to one already running. The first
 * is collected here; the second is listened for.
 */
export function DesktopTerminalWindowRedirect() {
    const router = useRouter();

    React.useEffect(() => {
        if (!isTerminalWindow()) {
            return;
        }

        let disposed = false;
        let unlisten: (() => void) | undefined;

        const go = (focus: TerminalFocus | null) => {
            // A fresh token every time. Landing on the tab that is already on
            // screen still has to bring it back into view, and an unchanged
            // route re-runs nothing.
            const request = String(Date.now());

            if (reachedWorkspace) {
                // The route is already up, so the request is only "show this
                // tab" — and it is handed over as a parameter change rather than
                // another navigation. Replacing the route would be a new screen:
                // the workspace would come back empty and rebuild, strip, scroll
                // position and every attached stream with it, which is a visible
                // reload of a window that was already showing terminals.
                if (focus) {
                    router.setParams({
                        machineId: focus.machineId,
                        terminalId: focus.terminalId,
                        request,
                    });
                }
                return;
            }

            const params = new URLSearchParams();
            if (focus) {
                params.set('machineId', focus.machineId);
                params.set('terminalId', focus.terminalId);
            }
            params.set('request', request);
            reachedWorkspace = true;
            router.replace(`/terminals?${params.toString()}`);
        };

        void (async () => {
            const initial = await takeDesktopTerminalFocus();
            if (disposed) {
                return;
            }
            // Subscribed before the first navigation, so a request arriving
            // mid-boot is not dropped.
            const stop = await listen<TerminalFocus>('terminal-focus', (event) => go(event.payload));
            if (disposed) {
                stop();
                return;
            }
            unlisten = stop;

            const timer = setTimeout(() => {
                if (!disposed) {
                    go(initial);
                }
            }, BOOT_DELAY_MS);
            return () => clearTimeout(timer);
        })();

        return () => {
            disposed = true;
            unlisten?.();
        };
        // Deliberately runs once: `useRouter()` hands back a fresh object on
        // every render, so depending on it would re-run the boot on each one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
}

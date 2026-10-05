import { Platform } from 'react-native';
import { isTauriDesktop } from '@/utils/tauri';
import { isTerminalWindow } from '@/desktop/desktopWindowUtils';
import { buildTerminalPopupPath, type TerminalPopupFocus } from './terminalPopupPath';

/**
 * Terminals in a browser of their own, the way the desktop app gives them a window.
 *
 * A terminal is somewhere you go and stay, next to the page you came from rather than inside
 * it. On the web that is a popup window running the same app at `/terminals`: it shares the
 * origin, so it shares the login, and it keeps its tab strip and its streams while the page
 * behind it is used for something else.
 *
 * Supported: Chrome, Edge, Brave, Opera, Firefox and Safari on a desktop, which all open a
 * sized popup from a click. Phones and tablets would only turn it into a tab, so they keep the
 * in-page screen — as does any browser that refuses the popup (see `openTerminalPopup`).
 */

export const TERMINAL_POPUP_NAME = 'happy-terminal';

const FOCUS_CHANNEL = 'happy-terminal-focus';
const POPUP_FEATURES = 'popup=yes,width=1000,height=680';

/** Whether this window is a terminal popup. The name survives navigation inside the window. */
export function isTerminalPopupWindow(): boolean {
    return Platform.OS === 'web'
        && typeof window !== 'undefined'
        && window.name === TERMINAL_POPUP_NAME;
}

/** Whether this window is a terminal's own — a desktop-app window or a browser popup. */
export function isDedicatedTerminalWindow(): boolean {
    return isTerminalWindow() || isTerminalPopupWindow();
}

export function supportsTerminalPopup(): boolean {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.open !== 'function') {
        return false;
    }
    // The desktop app has windows of its own.
    if (isTauriDesktop()) {
        return false;
    }
    // A popup on a phone or tablet is a tab, and an iPad's Safari says "Macintosh", so the
    // pointer is asked as well as the agent.
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
        return false;
    }
    return !window.matchMedia?.('(pointer: coarse)').matches;
}

export interface TerminalPopup {
    /**
     * Shows the workspace in the popup, on `focus` when given. False when the popup was closed
     * in the meantime.
     */
    show(focus?: TerminalPopupFocus): boolean;
    /** Gives the popup up, for when there turned out to be nothing to show in it. */
    abandon(): void;
}

/**
 * Opens the terminal popup, or finds the one that is already open.
 *
 * For an entry that wants the terminals but no particular one, `show()` with nothing raises the
 * popup and leaves it as it is. Null where popups are not
 * supported or the browser blocked it, which is the caller's cue to fall back to the page.
 *
 * Has to be called straight from the click that asked for the terminal: a browser opens a
 * window only for a gesture, and the wait for the shell to start ends it. So the window is
 * opened empty here and pointed at the workspace by `show` once there is a tab to show.
 */
export function openTerminalPopup(): TerminalPopup | null {
    if (!supportsTerminalPopup()) {
        return null;
    }
    const popup = window.open('', TERMINAL_POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
        return null;
    }
    // An empty name opens a blank window or returns the one already there, so what it shows
    // says which. The app's own pages are the same origin, which keeps the location readable.
    let isBlank = false;
    try {
        isBlank = popup.location.href === 'about:blank';
    } catch {
        isBlank = false;
    }

    return {
        show(focus) {
            if (popup.closed) {
                return false;
            }
            if (isBlank) {
                popup.location.replace(new URL(buildTerminalPopupPath(focus, String(Date.now())), window.location.href));
                return true;
            }
            // A running popup is told rather than navigated: reloading it would restart the app
            // and every attached stream in it.
            if (focus) {
                const channel = new BroadcastChannel(FOCUS_CHANNEL);
                channel.postMessage(focus);
                channel.close();
            }
            popup.focus();
            return true;
        },
        abandon() {
            if (isBlank && !popup.closed) {
                popup.close();
            }
        },
    };
}

/** Calls back when the page that opened this popup asks for another tab. Returns the unsubscribe. */
export function listenForTerminalPopupFocus(listener: (focus: TerminalPopupFocus) => void): () => void {
    if (typeof BroadcastChannel === 'undefined') {
        return () => {};
    }
    const channel = new BroadcastChannel(FOCUS_CHANNEL);
    channel.onmessage = (event: MessageEvent<TerminalPopupFocus>) => {
        const { machineId, terminalId } = event.data ?? {};
        if (typeof machineId === 'string' && typeof terminalId === 'string') {
            listener({ machineId, terminalId });
        }
    };
    return () => channel.close();
}

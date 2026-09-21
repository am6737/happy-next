import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTerminalWindow } from './desktopWindowUtils';

/** The payload-free event `src-tauri/src/lib.rs` asks for a tab with. */
const CLOSE_TAB_EVENT = 'terminal-close-tab';

/**
 * Closes a tab when the terminal window is asked to close, and lets the window
 * go only once there is nothing left to close.
 *
 * Every way of closing the desktop terminal window — the shortcut, the traffic
 * lights, the button the Windows title row draws — arrives as one request from
 * the shell, because whether it should take a tab or the window with it is a
 * question only the page can answer: the strip is as wide as the window and
 * lives in it. Answered here by keeping the count pushed upward, rather than by
 * sending the question down and waiting for a reply: the shell has to decide in
 * the instant the window is closed, when the page may not be in a position to
 * say anything at all.
 */
export function useTerminalWindowCloseRequest(input: {
    /** How many tabs the window is showing. Zero lets a close take the window. */
    tabCount: number;
    /** Closes the tab on screen, or null when there is none. */
    closeTab: (() => void) | null;
}): void {
    // Read through a ref so the listener is registered once and still sees the
    // tab that is on screen when the request actually arrives.
    const closeTabRef = useRef(input.closeTab);
    closeTabRef.current = input.closeTab;

    useEffect(() => {
        if (!isTerminalWindow()) {
            return;
        }
        void invoke('set_terminal_tab_count', { count: input.tabCount })
            .catch((error) => console.warn('Failed to report the terminal tab count:', error));
    }, [input.tabCount]);

    useEffect(() => {
        if (!isTerminalWindow()) {
            return;
        }

        let cancelled = false;
        let unlisten: (() => void) | undefined;
        void listen(CLOSE_TAB_EVENT, () => {
            closeTabRef.current?.();
        })
            .then((stop) => {
                if (cancelled) {
                    stop();
                } else {
                    unlisten = stop;
                }
            })
            .catch((error) => console.warn('Failed to listen for terminal tab close requests:', error));

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);
}

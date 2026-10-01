import { useEffect } from 'react';
import { isTerminalPopupWindow } from './terminalPopupWindow';

/**
 * Asks before a terminal popup goes away with terminals in it.
 *
 * Closing the window only lets go of the tabs: the shells keep running on their machines. But
 * it is also the end of what was on screen — scroll position, selection, a half-typed command —
 * and one stray click on the window's close button is all it takes, so the browser is asked to
 * confirm. The browser draws that prompt itself; a page cannot supply the wording, and some
 * browsers show it only after the page has been interacted with.
 *
 * Nothing is asked of an empty window, which has nothing to lose, and nothing outside a popup,
 * where the page is the app's own.
 */
export function useTerminalPopupCloseConfirm(tabCount: number): void {
    const hasTabs = tabCount > 0;

    useEffect(() => {
        if (!hasTabs || !isTerminalPopupWindow()) {
            return;
        }
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            // Older browsers decide whether to ask from this being set.
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasTabs]);
}

import type { Href } from 'expo-router';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { showToast } from '@/components/Toast';
import { isTauriDesktop } from '@/utils/tauri';
import { openDesktopTerminalWindow } from '@/desktop/desktopWindowUtils';
import { resolveTerminalDirectory, spawnTerminal } from './openTerminal';
import { revealTerminalInPanel, setTerminalPanelOpen } from './terminalPanel';
import { openTerminalPopup, supportsTerminalPopup } from './terminalPopupWindow';

/**
 * Opens a shell on a machine: in a session's directory when given one, else the machine's home.
 *
 * Shared by every "Open terminal" — a session's long-press menu and details screen, a machine's
 * details screen and sidebar menu — so all of them end up in the same place. `push` is the
 * caller's router, kept out of here so this stays a plain function.
 *
 * `inPanel` is where the app has a terminal panel (see `useTerminalPanelAvailable`): the shell
 * opens there, under whatever page is on screen. Anywhere else it opens the terminal screen.
 */
export function openMachineTerminal(input: {
    machineId: string;
    sessionPath?: string;
    push: (href: Href) => void;
    inPanel: boolean;
}): void {
    const { machineId, sessionPath, push, inPanel } = input;
    // The session's checkout is the directory someone wants a shell in; a session that has
    // not been given one yet still deserves a terminal, so fall back to the machine's home.
    const homeDir = storage.getState().machines[machineId]?.metadata?.homeDir;
    const cwd = resolveTerminalDirectory({ sessionPath, homeDir });
    // Opened at once rather than once the shell is up, so the click is answered right away.
    if (inPanel) {
        setTerminalPanelOpen(true);
    }
    void (async () => {
        try {
            // A second shell rather than the one already in that directory:
            // asking for a terminal is asking for a prompt, and being handed
            // the shell that is already open reads as the command having done
            // nothing.
            const terminal = await spawnTerminal({ machineId, cwd });
            if (inPanel) {
                revealTerminalInPanel({ machineId, terminalId: terminal.id });
                return;
            }
            push(`/terminals?machineId=${machineId}&terminalId=${terminal.id}`);
        } catch (error) {
            console.warn('Failed to open a terminal:', error);
            showToast(t('terminalSession.openFailed'));
        }
    })();
}

/** Whether a terminal can be moved out of the panel into a window of its own. */
export function canOpenTerminalWindow(): boolean {
    return isTauriDesktop() || supportsTerminalPopup();
}

/**
 * Shows a shell in the terminal window: the desktop app's own, or a popup in a browser.
 *
 * Has to be called straight from the click: a browser opens a window only for a gesture.
 * Returns false where the window could not be opened, a blocked popup among them.
 */
export function openTerminalWindow(target: { machineId: string; terminalId: string }): boolean {
    if (isTauriDesktop()) {
        openDesktopTerminalWindow(target).catch((error) => {
            console.warn('Failed to open the terminal window:', error);
            showToast(t('terminalSession.openFailed'));
        });
        return true;
    }
    return openTerminalPopup()?.show(target) ?? false;
}

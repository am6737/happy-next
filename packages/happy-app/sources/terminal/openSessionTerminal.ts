import type { Href } from 'expo-router';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { showToast } from '@/components/Toast';
import { isTauriDesktop } from '@/utils/tauri';
import { openDesktopTerminalWindow } from '@/desktop/desktopWindowUtils';
import { resolveTerminalDirectory, spawnTerminal } from './openTerminal';

/**
 * Opens a shell for a session: on the machine it runs on, in the directory it runs in.
 *
 * Shared by the session's long-press menu and its details screen, so both end up in the same
 * place. `push` is the caller's router, kept out of here so this stays a plain function.
 */
export function openSessionTerminal(input: {
    machineId: string;
    sessionPath?: string;
    push: (href: Href) => void;
}): void {
    const { machineId, sessionPath, push } = input;
    // The session's checkout is the directory someone wants a shell in; a session that has
    // not been given one yet still deserves a terminal, so fall back to the machine's home.
    const homeDir = storage.getState().machines[machineId]?.metadata?.homeDir;
    const cwd = resolveTerminalDirectory({ sessionPath, homeDir });
    void (async () => {
        try {
            // A second shell rather than the one already in that directory:
            // asking for a terminal is asking for a prompt, and being handed
            // the shell that is already open — perhaps in a window that is
            // already showing it — reads as the command having done nothing.
            const terminal = await spawnTerminal({ machineId, cwd });
            // On the desktop the terminals get their own window — they are a
            // place you go and stay, not a page inside the session list. Any-
            // where without windows, the workspace is an ordinary screen.
            if (isTauriDesktop()) {
                await openDesktopTerminalWindow({ machineId, terminalId: terminal.id });
                return;
            }
            push(`/terminals?machineId=${machineId}&terminalId=${terminal.id}`);
        } catch (error) {
            console.warn('Failed to open a terminal:', error);
            showToast(t('terminalSession.openFailed'));
        }
    })();
}

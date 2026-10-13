import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { Session } from '@/sync/storageTypes';
import { useIsTablet } from '@/utils/responsive';
import { openMachineTerminal } from '@/terminal/openMachineTerminal';
import { setTerminalPanelOpen } from '@/terminal/terminalPanelState';
import { isDedicatedTerminalWindow } from '@/terminal/terminalPopupWindow';

/**
 * Whether terminals open in the panel along the bottom of the app: on the web and in the desktop
 * app, wide enough for the sidebar (the same test the sidebar uses). The app on phones and
 * tablets, and a narrower browser, open the terminal screen instead. The terminal window is
 * all terminal already and has no panel.
 */
export function useTerminalPanelAvailable(): boolean {
    const isTablet = useIsTablet();
    return Platform.OS === 'web' && isTablet && !isDedicatedTerminalWindow();
}

/**
 * Every "Open terminal" in the app, sent to the one place terminals open: the panel where
 * there is one (`useTerminalPanelAvailable`), the terminal screen anywhere else.
 *
 * - `openSession` starts a shell in a session's directory.
 * - `openMachine` starts one in a machine's home directory.
 * - `openTerminals` shows the terminals without starting anything.
 */
export function useOpenTerminal() {
    const router = useRouter();
    const inPanel = useTerminalPanelAvailable();

    const openMachine = useCallback(
        (machineId: string, sessionPath?: string) => {
            openMachineTerminal({ machineId, sessionPath, push: router.push, inPanel });
        },
        [inPanel, router],
    );

    const openSession = useCallback(
        (session: Session) => {
            const machineId = session.metadata?.machineId;
            if (machineId) {
                openMachine(machineId, session.metadata?.path);
            }
        },
        [openMachine],
    );

    const openTerminals = useCallback(() => {
        if (inPanel) {
            setTerminalPanelOpen(true);
        } else {
            router.push('/terminals');
        }
    }, [inPanel, router]);

    return useMemo(() => ({ openSession, openMachine, openTerminals }), [openMachine, openSession, openTerminals]);
}

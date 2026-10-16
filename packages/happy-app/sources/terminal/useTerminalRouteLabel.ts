import { useCallback } from 'react';
import { useLocalMachineIds } from '@/desktop/desktopLocalMachine';
import { t } from '@/text';
import { getTerminalRoute, useTerminalRoutes } from './terminalRoute';
import type { TerminalTab } from './terminalTabs';

/**
 * What to tell the pointer about how a terminal is connected, or '' for
 * nothing to say.
 *
 * Only a terminal on this computer gets a word: the server is the one way to
 * reach any other, so saying so for those would just be noise, while a local
 * one on the server means the daemon here could not be reached.
 */
export function useTerminalRouteLabel(): (tab: TerminalTab) => string {
    const routes = useTerminalRoutes();
    const localMachineIds = useLocalMachineIds();
    return useCallback(
        (tab: TerminalTab) => {
            const route = getTerminalRoute(routes, tab.machineId, tab.terminal.id);
            if (route === 'local') {
                return t('terminalSession.routeLocal');
            }
            if (route === 'server' && localMachineIds.has(tab.machineId)) {
                return t('terminalSession.routeServerFallback');
            }
            return '';
        },
        [routes, localMachineIds],
    );
}

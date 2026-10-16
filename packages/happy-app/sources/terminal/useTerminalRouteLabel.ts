import { useCallback } from 'react';
import { t } from '@/text';
import { getTerminalRoute, useTerminalRoutes } from './terminalRoute';
import type { TerminalTab } from './terminalTabs';

/**
 * The tooltip for something that names a terminal: the text it shows, marked
 * when the terminal is reached directly on this computer rather than through
 * the server.
 */
export function useTerminalRouteLabel(): (tab: TerminalTab, text: string) => string {
    const routes = useTerminalRoutes();
    return useCallback(
        (tab: TerminalTab, text: string) =>
            getTerminalRoute(routes, tab.machineId, tab.terminal.id) === 'local'
                ? `${text} (${t('terminalSession.routeLocal')})`
                : text,
        [routes],
    );
}

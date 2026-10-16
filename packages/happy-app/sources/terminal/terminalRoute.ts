import { useSyncExternalStore } from 'react';

/**
 * Which way each open terminal currently reaches its daemon: over loopback to
 * a daemon on this computer, or through the server.
 *
 * Kept outside the stream so the tab strip and the panel's list, which do not
 * hold the streams, can say it for every terminal they list. Keyed by
 * `machineId:terminalId`; a terminal with no stream has no entry.
 */
export type TerminalRoute = 'local' | 'server';

let routes: ReadonlyMap<string, TerminalRoute> = new Map();
const listeners = new Set<() => void>();

function routeKey(machineId: string, terminalId: string): string {
    return `${machineId}:${terminalId}`;
}

export function setTerminalRoute(machineId: string, terminalId: string, route: TerminalRoute | null): void {
    const key = routeKey(machineId, terminalId);
    if ((routes.get(key) ?? null) === route) {
        return;
    }
    // Replaced rather than mutated, so the hook below sees a new snapshot.
    const next = new Map(routes);
    if (route) {
        next.set(key, route);
    } else {
        next.delete(key);
    }
    routes = next;
    for (const listener of [...listeners]) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getTerminalRoutes(): ReadonlyMap<string, TerminalRoute> {
    return routes;
}

export function useTerminalRoutes(): ReadonlyMap<string, TerminalRoute> {
    return useSyncExternalStore(subscribe, getTerminalRoutes, getTerminalRoutes);
}

export function getTerminalRoute(
    routesByKey: ReadonlyMap<string, TerminalRoute>,
    machineId: string,
    terminalId: string,
): TerminalRoute | null {
    return routesByKey.get(routeKey(machineId, terminalId)) ?? null;
}

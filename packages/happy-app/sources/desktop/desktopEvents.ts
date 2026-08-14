import type { NormalizedMessage } from '@/sync/typesRaw';

export type DesktopMessageEvent = {
    sessionId: string;
    messages: NormalizedMessage[];
};

export type DesktopPermissionRequestEvent = {
    sessionId: string;
    requestId: string;
    toolName: string;
};

type DesktopMessageListener = (event: DesktopMessageEvent) => void;
type DesktopPermissionRequestListener = (event: DesktopPermissionRequestEvent) => void;

const messageListeners = new Set<DesktopMessageListener>();
const permissionRequestListeners = new Set<DesktopPermissionRequestListener>();

export function emitDesktopMessages(event: DesktopMessageEvent): void {
    for (const listener of messageListeners) {
        listener(event);
    }
}

export function subscribeToDesktopMessages(listener: DesktopMessageListener): () => void {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
}

export function emitDesktopPermissionRequest(event: DesktopPermissionRequestEvent): void {
    for (const listener of permissionRequestListeners) {
        listener(event);
    }
}

export function subscribeToDesktopPermissionRequests(listener: DesktopPermissionRequestListener): () => void {
    permissionRequestListeners.add(listener);
    return () => permissionRequestListeners.delete(listener);
}

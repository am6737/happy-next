import type { NormalizedMessage } from '@/sync/typesRaw';

export type DesktopMessageEvent = {
    sessionId: string;
    messages: NormalizedMessage[];
};

type DesktopMessageListener = (event: DesktopMessageEvent) => void;

const messageListeners = new Set<DesktopMessageListener>();

export function emitDesktopMessages(event: DesktopMessageEvent): void {
    for (const listener of messageListeners) {
        listener(event);
    }
}

export function subscribeToDesktopMessages(listener: DesktopMessageListener): () => void {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
}

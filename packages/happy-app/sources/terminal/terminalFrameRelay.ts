import type { TerminalRelayedFrame } from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';

type FrameHandler = (frame: TerminalRelayedFrame) => void;

const handlers = new Map<string, Set<FrameHandler>>();
let detach: (() => void) | null = null;

function relayKey(machineId: string, terminalId: string): string {
    return `${machineId}:${terminalId}`;
}

function dispatch(frame: TerminalRelayedFrame): void {
    if (!frame) {
        return;
    }
    // Copied, because a handler that unsubscribes while it handles a frame must not
    // change what the rest of this frame's handlers are.
    for (const handler of [...(handlers.get(relayKey(frame.machineId, frame.terminalId)) ?? [])]) {
        handler(frame);
    }
}

/**
 * Receives the frames of one terminal, alongside whoever else is watching others.
 *
 * `apiSocket.onMessage` keeps a single handler per event: registering a second one replaces the
 * first, and either one's unsubscribe removes whatever is registered. Terminals kept mounted
 * while another tab is shown each have a stream of their own, so they would take the frames from
 * one another — and the stream shown last would be the only one still hearing anything. This
 * registers the one handler the socket allows and hands each frame to the stream it belongs to.
 */
export function subscribeTerminalFrames(
    machineId: string,
    terminalId: string,
    handler: FrameHandler,
): () => void {
    const key = relayKey(machineId, terminalId);
    const forKey = handlers.get(key) ?? new Set<FrameHandler>();
    forKey.add(handler);
    handlers.set(key, forKey);
    if (!detach) {
        detach = apiSocket.onMessage('terminal-frame', dispatch);
    }

    return () => {
        forKey.delete(handler);
        if (forKey.size === 0 && handlers.get(key) === forKey) {
            handlers.delete(key);
        }
        if (handlers.size === 0 && detach) {
            detach();
            detach = null;
        }
    };
}

import * as React from 'react';

/**
 * Re-renders the caller once a minute, for relative times ("3 minutes ago") that must age
 * on screen. Every caller shares one interval, which runs only while someone listens.
 */

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!timer) {
        timer = setInterval(() => {
            tick++;
            listeners.forEach((l) => l());
        }, 60_000);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
            clearInterval(timer);
            timer = null;
        }
    };
}

function getSnapshot() {
    return tick;
}

export function useMinuteTick(): number {
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

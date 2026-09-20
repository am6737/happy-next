import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriDesktop } from '@/utils/tauri';

/**
 * The machine ids the CLI on *this* computer is registered under, read once from its
 * `settings.json` files at startup.
 *
 * A session carries the machine id it was spawned on, so membership here is what tells a local
 * session apart from one running somewhere else — the only sessions a path can be revealed for.
 * Empty on every platform without a file manager, and on a computer that never ran the CLI.
 */
let localMachineIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let loaded = false;

export function subscribeToLocalMachineIds(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getLocalMachineIds(): ReadonlySet<string> {
    return localMachineIds;
}

/** Reads the ids once per session; every later call is a no-op, failures included. */
export function loadLocalMachineIds(): Promise<void> {
    if (loaded || !isTauriDesktop()) {
        return Promise.resolve();
    }
    loaded = true;
    return invoke<string[]>('get_desktop_local_machine_ids')
        .then((ids) => {
            localMachineIds = new Set(Array.isArray(ids) ? ids : []);
            for (const listener of listeners) {
                listener();
            }
        })
        .catch((error) => {
            console.warn('Failed to read this computer\'s machine ids:', error);
        });
}

/** The ids above, as a value the calling component re-renders on. */
export function useLocalMachineIds(): ReadonlySet<string> {
    React.useEffect(() => {
        void loadLocalMachineIds();
    }, []);
    return React.useSyncExternalStore(subscribeToLocalMachineIds, getLocalMachineIds, getLocalMachineIds);
}

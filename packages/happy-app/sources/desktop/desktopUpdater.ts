import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';

import { isTauriDesktop } from '@/utils/tauri';
import { isDesktopUpdaterBuild } from './desktopUpdaterUtils';

const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export type DesktopUpdatePhase =
    | 'idle'
    | 'unsupported'
    | 'checking'
    | 'upToDate'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';

export type DesktopUpdateSnapshot = {
    phase: DesktopUpdatePhase;
    currentVersion?: string;
    availableVersion?: string;
    releaseNotes?: string;
    publishedAt?: string;
    downloadedBytes: number;
    totalBytes?: number;
    error?: string;
};

type DesktopDiagnostics = {
    identifier: string;
    buildProfile: string;
    updaterTestMode?: boolean;
};

const initialSnapshot: DesktopUpdateSnapshot = {
    phase: 'idle',
    downloadedBytes: 0,
};

let snapshot = initialSnapshot;
let activeUpdate: Update | null = null;
let checkPromise: Promise<DesktopUpdateSnapshot> | null = null;
const listeners = new Set<() => void>();

function publish(next: DesktopUpdateSnapshot): DesktopUpdateSnapshot {
    snapshot = next;
    for (const listener of listeners) {
        listener();
    }
    return snapshot;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function getDesktopUpdateSnapshot(): DesktopUpdateSnapshot {
    return snapshot;
}

export function subscribeToDesktopUpdate(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

async function updaterIsSupported(): Promise<boolean> {
    if (!isTauriDesktop()) {
        return false;
    }
    const diagnostics = await invoke<DesktopDiagnostics>('get_desktop_diagnostics');
    return isDesktopUpdaterBuild(diagnostics);
}

async function closeActiveUpdate(): Promise<void> {
    if (!activeUpdate) {
        return;
    }
    const update = activeUpdate;
    activeUpdate = null;
    await update.close().catch(() => undefined);
}

export function checkForDesktopUpdate(): Promise<DesktopUpdateSnapshot> {
    if (checkPromise) {
        return checkPromise;
    }
    if (
        activeUpdate
        && (snapshot.phase === 'available' || snapshot.phase === 'downloading' || snapshot.phase === 'downloaded' || snapshot.phase === 'installing')
    ) {
        return Promise.resolve(snapshot);
    }

    checkPromise = (async () => {
        const currentVersion = await getVersion().catch(() => snapshot.currentVersion);
        try {
            if (!(await updaterIsSupported())) {
                return publish({
                    phase: 'unsupported',
                    currentVersion,
                    downloadedBytes: 0,
                });
            }

            publish({
                phase: 'checking',
                currentVersion,
                downloadedBytes: 0,
            });
            await closeActiveUpdate();
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
            if (!update) {
                return publish({
                    phase: 'upToDate',
                    currentVersion,
                    downloadedBytes: 0,
                });
            }

            activeUpdate = update;
            return publish({
                phase: 'available',
                currentVersion: update.currentVersion || currentVersion,
                availableVersion: update.version,
                releaseNotes: update.body,
                publishedAt: update.date,
                downloadedBytes: 0,
            });
        } catch (error) {
            return publish({
                phase: 'error',
                currentVersion,
                downloadedBytes: 0,
                error: errorMessage(error),
            });
        } finally {
            checkPromise = null;
        }
    })();

    return checkPromise;
}

export async function downloadDesktopUpdate(): Promise<DesktopUpdateSnapshot> {
    if (!activeUpdate) {
        return checkForDesktopUpdate();
    }
    if (snapshot.phase === 'downloading' || snapshot.phase === 'installing') {
        return snapshot;
    }

    let downloadedBytes = 0;
    let totalBytes: number | undefined;
    const base = {
        currentVersion: activeUpdate.currentVersion || snapshot.currentVersion,
        availableVersion: activeUpdate.version,
        releaseNotes: activeUpdate.body,
        publishedAt: activeUpdate.date,
    };
    publish({
        ...base,
        phase: 'downloading',
        downloadedBytes,
    });

    const onEvent = (event: DownloadEvent) => {
        if (event.event === 'Started') {
            totalBytes = event.data.contentLength;
            downloadedBytes = 0;
        } else if (event.event === 'Progress') {
            downloadedBytes += event.data.chunkLength;
        } else if (event.event === 'Finished' && totalBytes) {
            downloadedBytes = totalBytes;
        }
        publish({
            ...base,
            phase: 'downloading',
            downloadedBytes,
            totalBytes,
        });
    };

    try {
        await activeUpdate.download(onEvent, { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS });
        return publish({
            ...base,
            phase: 'downloaded',
            downloadedBytes,
            totalBytes,
        });
    } catch (error) {
        return publish({
            ...base,
            phase: 'error',
            downloadedBytes,
            totalBytes,
            error: errorMessage(error),
        });
    }
}

export async function installDesktopUpdateAndRelaunch(): Promise<DesktopUpdateSnapshot> {
    if (!activeUpdate || snapshot.phase !== 'downloaded') {
        return snapshot;
    }
    const installing = publish({ ...snapshot, phase: 'installing', error: undefined });
    try {
        await activeUpdate.install();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
        return installing;
    } catch (error) {
        return publish({
            ...snapshot,
            phase: 'error',
            error: errorMessage(error),
        });
    }
}

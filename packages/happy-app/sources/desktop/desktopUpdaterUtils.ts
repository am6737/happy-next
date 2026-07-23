import type { DesktopUpdateSnapshot } from './desktopUpdater';

const PRODUCTION_IDENTIFIER = 'com.hitosea.happy';
const UPDATER_TEST_IDENTIFIER = 'com.hitosea.happy.updatetest';

export function desktopUpdateProgress(value: Pick<DesktopUpdateSnapshot, 'downloadedBytes' | 'totalBytes'>): number | null {
    if (!value.totalBytes || value.totalBytes <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, value.downloadedBytes / value.totalBytes));
}

export function isDesktopUpdaterBuild(diagnostics: {
    identifier: string;
    buildProfile: string;
    updaterTestMode?: boolean;
}): boolean {
    if (diagnostics.buildProfile !== 'release') {
        return false;
    }
    return diagnostics.identifier === PRODUCTION_IDENTIFIER
        || (diagnostics.identifier === UPDATER_TEST_IDENTIFIER && diagnostics.updaterTestMode === true);
}

import type { DesktopUpdateSnapshot } from './desktopUpdater';

const PRODUCTION_IDENTIFIER = 'com.hitosea.happy';

export function desktopUpdateProgress(value: Pick<DesktopUpdateSnapshot, 'downloadedBytes' | 'totalBytes'>): number | null {
    if (!value.totalBytes || value.totalBytes <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, value.downloadedBytes / value.totalBytes));
}

export function isProductionDesktopBuild(diagnostics: { identifier: string; buildProfile: string }): boolean {
    return diagnostics.identifier === PRODUCTION_IDENTIFIER && diagnostics.buildProfile === 'release';
}

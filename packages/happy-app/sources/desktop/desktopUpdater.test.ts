import { describe, expect, it } from 'vitest';

import { desktopUpdateProgress, isDesktopUpdaterBuild } from './desktopUpdaterUtils';

describe('desktop updater helpers', () => {
    it('only enables updates for production desktop releases', () => {
        expect(isDesktopUpdaterBuild({ identifier: 'com.hitosea.happy', buildProfile: 'release' })).toBe(true);
        expect(isDesktopUpdaterBuild({ identifier: 'com.hitosea.happy.dev', buildProfile: 'release' })).toBe(false);
        expect(isDesktopUpdaterBuild({ identifier: 'com.hitosea.happy', buildProfile: 'debug' })).toBe(false);
    });

    it('only enables the isolated updater test app with an explicit native build flag', () => {
        expect(isDesktopUpdaterBuild({
            identifier: 'com.hitosea.happy.updatetest',
            buildProfile: 'release',
            updaterTestMode: true,
        })).toBe(true);
        expect(isDesktopUpdaterBuild({
            identifier: 'com.hitosea.happy.updatetest',
            buildProfile: 'release',
            updaterTestMode: false,
        })).toBe(false);
    });

    it('calculates bounded download progress', () => {
        expect(desktopUpdateProgress({ downloadedBytes: 25, totalBytes: 100 })).toBe(0.25);
        expect(desktopUpdateProgress({ downloadedBytes: 120, totalBytes: 100 })).toBe(1);
        expect(desktopUpdateProgress({ downloadedBytes: 10 })).toBeNull();
    });
});

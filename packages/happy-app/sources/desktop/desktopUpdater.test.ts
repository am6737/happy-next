import { describe, expect, it } from 'vitest';

import { desktopUpdateProgress, isProductionDesktopBuild } from './desktopUpdaterUtils';

describe('desktop updater helpers', () => {
    it('only enables updates for production desktop releases', () => {
        expect(isProductionDesktopBuild({ identifier: 'com.hitosea.happy', buildProfile: 'release' })).toBe(true);
        expect(isProductionDesktopBuild({ identifier: 'com.hitosea.happy.dev', buildProfile: 'release' })).toBe(false);
        expect(isProductionDesktopBuild({ identifier: 'com.hitosea.happy', buildProfile: 'debug' })).toBe(false);
    });

    it('calculates bounded download progress', () => {
        expect(desktopUpdateProgress({ downloadedBytes: 25, totalBytes: 100 })).toBe(0.25);
        expect(desktopUpdateProgress({ downloadedBytes: 120, totalBytes: 100 })).toBe(1);
        expect(desktopUpdateProgress({ downloadedBytes: 10 })).toBeNull();
    });
});

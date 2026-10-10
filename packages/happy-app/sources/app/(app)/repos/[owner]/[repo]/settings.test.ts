import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./settings.tsx', import.meta.url), 'utf8');

describe('repository settings', () => {
    it('keeps GitHub synchronization controls out of the settings page', () => {
        expect(source).not.toContain('GITHUB SYNC');
        expect(source).not.toContain('repoSettings.githubSync');
        expect(source).not.toContain('repoSettings.githubAccount');
        expect(source).not.toContain('repoSettings.lastSynced');
        expect(source).not.toContain('repoSettings.syncNow');
        expect(source).not.toContain('useProfile');
        expect(source).not.toContain('syncLoading');
    });

    it('retains the machine and Auto Pilot settings sections', () => {
        expect(source).toContain('repoSettings.machines');
        expect(source).toContain('repoSettings.autoPilot');
    });
});

import { describe, expect, it } from 'vitest';
import { localSettingsDefaults, localSettingsParse } from './localSettings';

describe('localSettings session project collapse state', () => {
    it('defaults to all project groups expanded', () => {
        expect(localSettingsParse({}).collapsedSessionProjectGroups).toEqual({});
        expect(localSettingsDefaults.collapsedSessionProjectGroups).toEqual({});
    });

    it('preserves collapsed project groups across persistence parsing', () => {
        const collapsedSessionProjectGroups = {
            'path:%2FUsers%2Fme%2Fproject': true,
            'path:': true,
        };

        expect(localSettingsParse({ collapsedSessionProjectGroups }).collapsedSessionProjectGroups)
            .toEqual(collapsedSessionProjectGroups);
    });
});

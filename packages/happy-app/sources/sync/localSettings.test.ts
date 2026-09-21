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

describe('localSettings terminal state', () => {
    it('defaults to no order, no names and no remembered target', () => {
        expect(localSettingsParse({}).terminalTabOrder).toEqual([]);
        expect(localSettingsParse({}).terminalTabNames).toEqual({});
        expect(localSettingsParse({}).terminalNewTarget).toBeNull();
        expect(localSettingsDefaults.terminalTabOrder).toEqual([]);
        expect(localSettingsDefaults.terminalTabNames).toEqual({});
        expect(localSettingsDefaults.terminalNewTarget).toBeNull();
    });

    it('preserves a dragged order and a remembered target across persistence parsing', () => {
        const terminalTabOrder = ['machine_a:term_1', 'machine_b:term_2'];
        const terminalNewTarget = { machineId: 'machine_a', cwd: '/Users/someone/project' };

        const parsed = localSettingsParse({ terminalTabOrder, terminalNewTarget });

        expect(parsed.terminalTabOrder).toEqual(terminalTabOrder);
        expect(parsed.terminalNewTarget).toEqual(terminalNewTarget);
    });

    it('preserves names given to tabs across persistence parsing', () => {
        const terminalTabNames = { 'machine_a:term_1': 'build server', 'machine_b:term_2': 'logs' };

        expect(localSettingsParse({ terminalTabNames }).terminalTabNames).toEqual(terminalTabNames);
    });

    it('falls back to every default for a malformed target', () => {
        // One unparsable field fails the whole object, so this reads as an empty
        // settings file rather than a half-read one. Worth knowing: it costs the
        // order too, not just the target.
        const parsed = localSettingsParse({
            terminalTabOrder: ['machine_a:term_1'],
            terminalNewTarget: { machineId: 5 },
        });

        expect(parsed.terminalNewTarget).toBeNull();
        expect(parsed.terminalTabOrder).toEqual([]);
    });
});

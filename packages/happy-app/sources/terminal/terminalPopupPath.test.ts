import { describe, expect, it } from 'vitest';
import { buildTerminalPopupPath } from './terminalPopupPath';

describe('buildTerminalPopupPath', () => {
    it('points the workspace at one tab', () => {
        const path = buildTerminalPopupPath({ machineId: 'm1', terminalId: 't1' }, '42');
        expect(path).toBe('/terminals?machineId=m1&terminalId=t1&request=42');
    });

    it('leaves the tab to the workspace when none is asked for', () => {
        expect(buildTerminalPopupPath(undefined, '7')).toBe('/terminals?request=7');
    });

    it('escapes ids rather than trusting them', () => {
        const path = buildTerminalPopupPath({ machineId: 'a&b', terminalId: 'c d' }, '1');
        expect(path).toBe('/terminals?machineId=a%26b&terminalId=c+d&request=1');
    });
});

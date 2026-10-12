import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalInfo } from 'happy-wire';
import type { TerminalTab } from './terminalTabs';

const settings = { terminalPanelOpen: false };
const applyLocalSettings = vi.fn((delta: Partial<typeof settings>) => Object.assign(settings, delta));
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ localSettings: settings, applyLocalSettings }) },
    useLocalSetting: vi.fn(),
}));

const {
    clampTerminalPanelHeight,
    clampTerminalPanelListWidth,
    groupTerminalTabsByMachine,
    resolveTerminalPanelColors,
    resolveTerminalPanelContext,
    setTerminalPanelOpen,
    toggleTerminalPanel,
    TERMINAL_PANEL_LIST_MIN_WIDTH,
    TERMINAL_PANEL_MIN_HEIGHT,
    TERMINAL_PANEL_PAGE_MIN_HEIGHT,
} = await import('./terminalPanel');

function tab(id: string, machineId: string): TerminalTab {
    const terminal: TerminalInfo = { id, cwd: '/w', size: { rows: 24, cols: 80 }, exited: false };
    return { machineId, terminal };
}

describe('clampTerminalPanelHeight', () => {
    it('keeps a height that fits', () => {
        expect(clampTerminalPanelHeight(300, 900)).toBe(300);
    });

    it('never goes below the smallest panel', () => {
        expect(clampTerminalPanelHeight(20, 900)).toBe(TERMINAL_PANEL_MIN_HEIGHT);
    });

    it('always leaves the page above some room', () => {
        expect(clampTerminalPanelHeight(Number.MAX_SAFE_INTEGER, 900)).toBe(900 - TERMINAL_PANEL_PAGE_MIN_HEIGHT);
    });

    it('keeps the smallest panel in a column too short for both', () => {
        expect(clampTerminalPanelHeight(300, 200)).toBe(TERMINAL_PANEL_MIN_HEIGHT);
    });
});

describe('clampTerminalPanelListWidth', () => {
    it('keeps a width that fits', () => {
        expect(clampTerminalPanelListWidth(240, 1200)).toBe(240);
    });

    it('leaves the terminal at least half the panel', () => {
        expect(clampTerminalPanelListWidth(400, 600)).toBe(300);
    });

    it('never goes below the narrowest list', () => {
        expect(clampTerminalPanelListWidth(40, 1200)).toBe(TERMINAL_PANEL_LIST_MIN_WIDTH);
    });
});

describe('resolveTerminalPanelContext', () => {
    it('reads a session from its pages', () => {
        expect(resolveTerminalPanelContext('/session/abc')).toEqual({ kind: 'session', sessionId: 'abc' });
        expect(resolveTerminalPanelContext('/session/abc/info')).toEqual({ kind: 'session', sessionId: 'abc' });
    });

    it('reads a machine from its pages', () => {
        expect(resolveTerminalPanelContext('/machine/m1')).toEqual({ kind: 'machine', machineId: 'm1' });
    });

    it('reads nothing from any other page', () => {
        expect(resolveTerminalPanelContext('/settings')).toBeNull();
        expect(resolveTerminalPanelContext('/')).toBeNull();
    });
});

describe('resolveTerminalPanelColors', () => {
    it('takes the terminal background and fades its text for the row states', () => {
        const colors = resolveTerminalPanelColors({ background: '#1E1E1E', foreground: '#E0E0E0' });
        expect(colors.background).toBe('#1E1E1E');
        expect(colors.hover).toBe('#E0E0E014');
        expect(colors.selected).toBe('#E0E0E024');
    });

    it('keeps a text colour it cannot fade', () => {
        expect(resolveTerminalPanelColors({ foreground: 'white' }).hover).toBe('white');
    });
});

describe('groupTerminalTabsByMachine', () => {
    it('groups by machine in the order the machines first appear, keeping tab order', () => {
        const groups = groupTerminalTabsByMachine([tab('1', 'b'), tab('2', 'a'), tab('3', 'b')]);
        expect(groups.map((group) => group.machineId)).toEqual(['b', 'a']);
        expect(groups[0]!.tabs.map((grouped) => grouped.terminal.id)).toEqual(['1', '3']);
    });
});

describe('panel open state', () => {
    beforeEach(() => {
        settings.terminalPanelOpen = false;
        applyLocalSettings.mockClear();
    });

    it('toggles open and closed', () => {
        toggleTerminalPanel();
        expect(settings.terminalPanelOpen).toBe(true);
        toggleTerminalPanel();
        expect(settings.terminalPanelOpen).toBe(false);
    });

    it('writes nothing when already in the asked state', () => {
        setTerminalPanelOpen(false);
        expect(applyLocalSettings).not.toHaveBeenCalled();
    });
});

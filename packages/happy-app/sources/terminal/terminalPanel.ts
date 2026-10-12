import { create } from 'zustand';
import { storage, useLocalSetting } from '@/sync/storage';
import type { TerminalTab } from './terminalTabs';

/**
 * The terminal panel along the bottom of the app, the way an editor keeps one under its files.
 *
 * Web and desktop only, wide enough for the sidebar: one panel for the whole app, holding every
 * shell on every machine, shown under whatever page is open. The app on phones and tablets, and
 * a browser too narrow for the sidebar, open the terminal screen instead.
 */

/** The smallest the panel can be dragged to, which still leaves its header and a few rows. */
export const TERMINAL_PANEL_MIN_HEIGHT = 140;
/** What the panel opens at before anyone has dragged it. */
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 300;
/** What the panel always leaves of the page above it, maximised or not. */
export const TERMINAL_PANEL_PAGE_MIN_HEIGHT = 160;

/** A panel height that fits in a column `available` tall. */
export function clampTerminalPanelHeight(height: number, available: number): number {
    const max = Math.max(TERMINAL_PANEL_MIN_HEIGHT, available - TERMINAL_PANEL_PAGE_MIN_HEIGHT);
    return Math.round(Math.min(max, Math.max(TERMINAL_PANEL_MIN_HEIGHT, height)));
}

export const TERMINAL_PANEL_LIST_MIN_WIDTH = 50;
export const TERMINAL_PANEL_LIST_DEFAULT_WIDTH = 220;
const TERMINAL_PANEL_LIST_MAX_WIDTH = 420;
/** Narrower than this, the list shows each terminal's icon and nothing else. */
export const TERMINAL_PANEL_LIST_COMPACT_WIDTH = 70;

/** A width for the terminal list that leaves the terminal beside it at least half the panel. */
export function clampTerminalPanelListWidth(width: number, panelWidth: number): number {
    const max = Math.max(TERMINAL_PANEL_LIST_MIN_WIDTH, Math.min(TERMINAL_PANEL_LIST_MAX_WIDTH, panelWidth / 2));
    return Math.round(Math.min(max, Math.max(TERMINAL_PANEL_LIST_MIN_WIDTH, width)));
}

/**
 * The panel's own colours, taken from the terminal's so the header and the list read as part of
 * the shell rather than the page: its background, its text, and that text faded for hovered and
 * selected rows and for dividers.
 */
export interface TerminalPanelColors {
    background: string;
    foreground: string;
    hover: string;
    selected: string;
    divider: string;
}

export function resolveTerminalPanelColors(theme: { background?: string; foreground?: string }): TerminalPanelColors {
    const background = theme.background ?? '#1E1E1E';
    const foreground = theme.foreground ?? '#E0E0E0';
    // A hex alpha only goes on a plain #RRGGBB; anything else keeps the colour as it is.
    const faded = (alpha: string) => (/^#[0-9a-f]{6}$/i.test(foreground) ? `${foreground}${alpha}` : foreground);
    return { background, foreground, hover: faded('14'), selected: faded('24'), divider: faded('26') };
}

/**
 * What the panel knows only for as long as the app runs.
 *
 * `engaged` is whether someone has opened or used the panel since the app started: a panel
 * restored open with the app leaves the keyboard where it is until then. `focus` is the shell
 * something just asked the panel to show, a fresh object for each request, so asking again
 * for the one already shown still brings it back.
 */
interface TerminalPanelRuntime {
    engaged: boolean;
    focus: { machineId: string; terminalId: string } | null;
}

const useTerminalPanelRuntime = create<TerminalPanelRuntime>(() => ({ engaged: false, focus: null }));

export function useTerminalPanelOpen(): boolean {
    return useLocalSetting('terminalPanelOpen');
}

export function useTerminalPanelEngaged(): boolean {
    return useTerminalPanelRuntime((state) => state.engaged);
}

export function useTerminalPanelFocus(): TerminalPanelRuntime['focus'] {
    return useTerminalPanelRuntime((state) => state.focus);
}

export function markTerminalPanelEngaged(): void {
    if (!useTerminalPanelRuntime.getState().engaged) {
        useTerminalPanelRuntime.setState({ engaged: true });
    }
}

export function setTerminalPanelOpen(open: boolean): void {
    if (open) {
        markTerminalPanelEngaged();
    }
    if (storage.getState().localSettings.terminalPanelOpen !== open) {
        storage.getState().applyLocalSettings({ terminalPanelOpen: open });
    }
}

export function toggleTerminalPanel(): void {
    setTerminalPanelOpen(!storage.getState().localSettings.terminalPanelOpen);
}

/** Opens the panel on one particular shell. */
export function revealTerminalInPanel(target: { machineId: string; terminalId: string }): void {
    setTerminalPanelOpen(true);
    useTerminalPanelRuntime.setState({ focus: { machineId: target.machineId, terminalId: target.terminalId } });
}

/** What the page on screen says about where a new shell belongs. */
export type TerminalPanelContext =
    | { kind: 'session'; sessionId: string }
    | { kind: 'machine'; machineId: string }
    | null;

const SESSION_ROUTE = /^\/session\/([^/]+)/;
const MACHINE_ROUTE = /^\/machine\/([^/]+)/;

export function resolveTerminalPanelContext(pathname: string): TerminalPanelContext {
    const session = SESSION_ROUTE.exec(pathname)?.[1];
    if (session) {
        return { kind: 'session', sessionId: session };
    }
    const machine = MACHINE_ROUTE.exec(pathname)?.[1];
    if (machine) {
        return { kind: 'machine', machineId: machine };
    }
    return null;
}

export interface TerminalTabGroup {
    machineId: string;
    tabs: TerminalTab[];
}

/** The tabs by machine, machines in the order their first tab comes in, tabs kept in order. */
export function groupTerminalTabsByMachine(tabs: readonly TerminalTab[]): TerminalTabGroup[] {
    const groups = new Map<string, TerminalTab[]>();
    for (const tab of tabs) {
        const group = groups.get(tab.machineId);
        if (group) {
            group.push(tab);
        } else {
            groups.set(tab.machineId, [tab]);
        }
    }
    return [...groups].map(([machineId, grouped]) => ({ machineId, tabs: grouped }));
}

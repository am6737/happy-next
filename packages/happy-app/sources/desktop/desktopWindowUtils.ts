import { isTauriDesktop } from '@/utils/tauri';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type DesktopPlatform = 'macos' | 'windows';

export function getDesktopPlatform(): DesktopPlatform | null {
    if (!isTauriDesktop() || typeof navigator === 'undefined') {
        return null;
    }

    const navigatorWithUserAgentData = navigator as Navigator & {
        userAgentData?: { platform?: string };
    };
    const platform = [
        navigatorWithUserAgentData.userAgentData?.platform,
        navigator.platform,
        navigator.userAgent,
    ].filter(Boolean).join(' ');

    return /Mac|iPhone|iPad/i.test(platform) ? 'macos' : 'windows';
}

export function startDesktopWindowDragging(): void {
    if (!isTauriDesktop()) {
        return;
    }
    void invoke('start_desktop_window_dragging')
        .catch((error) => console.warn('Failed to start desktop window dragging:', error));
}

const DESKTOP_NO_DRAG_SELECTOR = '[data-desktop-no-drag], button, [role="button"], [tabindex], a, input, textarea, select';

export function toggleDesktopWindowMaximized(): void {
    if (!isTauriDesktop()) {
        return;
    }

    void getCurrentWindow().toggleMaximize()
        .catch((error) => console.warn('Failed to toggle desktop window maximized state:', error));
}

export function handleDesktopTitleBarMouseDown(
    event: any,
    options: { allowMaximize?: boolean } = {},
): void {
    if (!isTauriDesktop() || event.button !== 0) {
        return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest?.(DESKTOP_NO_DRAG_SELECTOR)) {
        return;
    }

    event.stopPropagation?.();
    event.preventDefault?.();

    if ((event.detail ?? 1) >= 2) {
        if (options.allowMaximize !== false) {
            toggleDesktopWindowMaximized();
        }
        return;
    }

    startDesktopWindowDragging();
}

const TERMINAL_WINDOW_LABEL = 'terminal';

/**
 * Whether this window is the terminal window.
 *
 * The window is opened at the app's root document, because a link to a route
 * would assume the export had produced a file for that path. Its identity lives
 * in its label instead, which is the one thing a webview can read about itself
 * before anything has loaded.
 */
export function isTerminalWindow(): boolean {
    if (!isTauriDesktop()) {
        return false;
    }
    return getCurrentWindow().label === TERMINAL_WINDOW_LABEL;
}

/** The tab a terminal window should open on, when something specific asked for it. */
export interface TerminalFocus {
    machineId: string;
    terminalId: string;
}

/** Opens the terminal window, or raises it and switches it to `focus`. */
export async function openDesktopTerminalWindow(focus?: TerminalFocus): Promise<void> {
    if (!isTauriDesktop()) {
        throw new Error('Terminal windows are only available in the Tauri app');
    }
    await invoke('open_desktop_terminal_window', { focus: focus ?? null });
}

/**
 * Collects the tab a just-opened terminal window was asked to show.
 *
 * Someone has to hold the request between the window being asked for and the
 * app inside it starting up, and the two are different processes as far as the
 * webview is concerned — so the desktop shell holds it, and the window takes it
 * once, on mount.
 */
export async function takeDesktopTerminalFocus(): Promise<TerminalFocus | null> {
    if (!isTauriDesktop()) {
        return null;
    }
    return await invoke<TerminalFocus | null>('take_terminal_focus');
}

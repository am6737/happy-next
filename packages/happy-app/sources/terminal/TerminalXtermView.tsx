import type { TerminalXtermViewProps } from "./terminalXtermViewProps";

/**
 * Whether this platform draws the terminal with xterm.js. Only the web build does (see
 * `TerminalXtermView.web.tsx`), where xterm's DOM renderer, selection, scrollback and IME are
 * available; the phone keeps the grid renderer.
 */
export const TERMINAL_XTERM_VIEW_SUPPORTED = false;

export function TerminalXtermView(_props: TerminalXtermViewProps): null {
  return null;
}

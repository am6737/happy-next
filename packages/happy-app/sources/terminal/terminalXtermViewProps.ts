import type { ITheme } from "@xterm/headless";

import type { TerminalMirror } from "./terminalMirror";

export interface TerminalXtermViewProps {
  xtermTheme: ITheme;
  /**
   * Whether this terminal is the one on screen. A terminal that is kept mounted while another
   * tab is shown is hidden, and takes the keyboard back when it is shown again.
   */
  active: boolean;
  /**
   * Whether showing this terminal may take the keyboard. False for a terminal that appears without
   * anyone asking for it — a panel restored with the app — which must leave the focus where it is.
   */
  autoFocus?: boolean;
  /**
   * The terminal that is drawn here, once it exists, and `null` when it goes away. The
   * stream is given this as its mirror, so what the shell writes lands on this screen.
   */
  onMirror: (mirror: TerminalMirror | null) => void;
  /** The grid that fits the space this view has. Called again whenever the space changes. */
  onSize: (size: { rows: number; cols: number }) => void;
  /** What the keyboard produced — typing, paste and IME composition alike. */
  onInput: (data: string) => void;
}

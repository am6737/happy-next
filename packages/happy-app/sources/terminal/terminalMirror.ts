import type {
  NativeHeadlessTerminalInputModeState,
  NativeTerminalWriteData,
  TerminalViewportState,
} from "./headlessTerminalState";

/**
 * The emulator a `TerminalStream` feeds: it takes the shell's output and can say which input
 * modes the shell has switched on.
 *
 * Two things implement it. The headless terminal parses output into a grid that the native
 * renderer draws; `getViewportState` is how it hands that grid over. On the web a real xterm.js
 * terminal draws itself, so it has no grid to give and leaves `getViewportState` out.
 */
export interface TerminalMirror {
  write(data: NativeTerminalWriteData): Promise<void>;
  resize(size: { rows: number; cols: number }): void;
  reset(): void;
  getInputModeState(): NativeHeadlessTerminalInputModeState;
  getViewportState?(): TerminalViewportState;
  dispose(): void;
}

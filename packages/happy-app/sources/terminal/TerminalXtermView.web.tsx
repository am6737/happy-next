import { memo, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import type { TerminalMirror } from "./terminalMirror";
import type { TerminalXtermViewProps } from "./terminalXtermViewProps";

export const TERMINAL_XTERM_VIEW_SUPPORTED = true;

const FONT_FAMILY = 'Menlo, Monaco, "Cascadia Mono", Consolas, "Liberation Mono", monospace';
const FONT_SIZE = 13;
const SCROLLBACK_LINES = 5000;

/**
 * The terminal, drawn by xterm.js.
 *
 * xterm lays every glyph on its own cell, which is what makes columns line up, double-width
 * characters take two cells and styled runs stay where they belong — all things the grid
 * renderer has to emulate. It also brings scrollback, selection and copy, and takes keyboard,
 * paste and IME input through its own textarea.
 *
 * It parses nothing here that the stream does not hand it: output is written to it by
 * `TerminalStream`, and what it reads from the keyboard goes back out through `onInput`.
 */
export const TerminalXtermView = memo(({ xtermTheme, active, onMirror, onSize, onInput }: TerminalXtermViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  // Kept in refs so the terminal below is built once, not rebuilt whenever a parent re-renders.
  const themeRef = useRef(xtermTheme);
  themeRef.current = xtermTheme;
  const onMirrorRef = useRef(onMirror);
  onMirrorRef.current = onMirror;
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      cursorBlink: true,
      cursorStyle: "block",
      // A terminal that is not focused draws its cursor hollow.
      cursorInactiveStyle: "outline",
      scrollback: SCROLLBACK_LINES,
      // Option is the Alt key of a terminal, not a way to type accents.
      macOptionIsMeta: true,
      theme: themeRef.current,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;

    const measure = (): { rows: number; cols: number } | null => {
      const dimensions = fit.proposeDimensions();
      return dimensions && dimensions.rows > 0 && dimensions.cols > 0
        ? { rows: dimensions.rows, cols: dimensions.cols }
        : null;
    };

    const mirror: TerminalMirror = {
      write: (data) => new Promise<void>((resolve) => terminal.write(data, resolve)),
      resize: ({ rows, cols }) => terminal.resize(cols, rows),
      reset: () => terminal.reset(),
      getInputModeState: () => ({
        applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
        bracketedPaste: terminal.modes.bracketedPasteMode,
      }),
      // This view owns the terminal and disposes it when it unmounts.
      dispose: () => {},
    };

    // Start at the size the view really has: the stream attaches at the size it is given, and a
    // terminal still at xterm's default 80x24 would be resized the moment the first frame lands.
    const initialSize = measure();
    if (initialSize) {
      terminal.resize(initialSize.cols, initialSize.rows);
      onSizeRef.current(initialSize);
    }

    const dataSubscription = terminal.onData((data) => onInputRef.current(data));
    const observer = new ResizeObserver(() => {
      const size = measure();
      if (size) {
        onSizeRef.current(size);
      }
    });
    observer.observe(container);

    onMirrorRef.current(mirror);
    terminal.focus();

    return () => {
      observer.disconnect();
      dataSubscription.dispose();
      onMirrorRef.current(null);
      terminalRef.current = null;
      terminal.dispose();
    };
  }, []);

  // Hiding the terminal takes the focus off it with the element; showing it has to put it back.
  useEffect(() => {
    if (active) {
      terminalRef.current?.focus();
    }
  }, [active]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  return (
    <View style={styles.root}>
      <div ref={containerRef} style={containerStyle} />
    </View>
  );
});

const containerStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    margin: 12,
  },
});

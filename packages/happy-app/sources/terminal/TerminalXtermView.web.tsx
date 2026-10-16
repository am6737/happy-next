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
export const TerminalXtermView = memo(({ xtermTheme, active, autoFocus = true, onMirror, onSize, onInput }: TerminalXtermViewProps) => {
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
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;

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

    // With an input method active, WebKit reports digits and punctuation as keyCode 229 and
    // inserts their text a moment later. xterm reads that text by diffing its textarea on a timer
    // only one key can hold at a time, so a second key pressed before the first one's text lands
    // is never read: 1 and 2 typed in quick rollover give just 1. These keys are taken from the
    // input event instead, which carries exactly what was inserted. The listener captures on the
    // container so xterm's own input handler on the textarea does not see it a second time.
    let imeKeysPending = 0;
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.keyCode === 229 && !event.isComposing) {
        imeKeysPending += 1;
        return false;
      }
      return true;
    });
    const takeImeInput = (event: Event) => {
      const input = event as InputEvent;
      if (imeKeysPending === 0 || input.isComposing || input.inputType !== "insertText" || !input.data) {
        return;
      }
      imeKeysPending -= 1;
      event.stopPropagation();
      onInputRef.current(input.data);
    };
    // A key that starts a composition goes to the composition, which sends its own text.
    const resetImeKeys = () => {
      imeKeysPending = 0;
    };
    container.addEventListener("input", takeImeInput, true);
    container.addEventListener("compositionstart", resetImeKeys, true);
    const observer = new ResizeObserver(() => {
      const size = measure();
      if (size) {
        onSizeRef.current(size);
      }
    });
    observer.observe(container);

    onMirrorRef.current(mirror);
    if (autoFocusRef.current) {
      terminal.focus();
    }

    return () => {
      observer.disconnect();
      dataSubscription.dispose();
      container.removeEventListener("input", takeImeInput, true);
      container.removeEventListener("compositionstart", resetImeKeys, true);
      onMirrorRef.current(null);
      terminalRef.current = null;
      terminal.dispose();
    };
  }, []);

  // Hiding the terminal takes the focus off it with the element; showing it has to put it back.
  useEffect(() => {
    if (active && autoFocusRef.current) {
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

/**
 * Turns a key press into the bytes a terminal expects.
 *
 * Ported from Paseo (https://github.com/getpaseo/paseo), Apache-2.0.
 * Copyright (c) 2025-present Mohamed Boudra.
 *
 * Trimmed to what a soft or attached keyboard can actually produce: no
 * function keys, and none of the Win32 or Kitty input-mode encodings, which
 * only exist for terminals that negotiated them.
 */

export interface TerminalInputModeState {
  /** DECCKM: arrows switch from `CSI A` to `SS3 A`. */
  applicationCursorKeys: boolean;
  bracketedPaste: boolean;
}

export interface TerminalKeyInput {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface TerminalKeyInputEncodingOptions {
  inputMode?: TerminalInputModeState;
}

/** xterm's modifier parameter: 1 + shift(1) + alt(2) + ctrl(4) + meta(8). */
function modifierParam(input: TerminalKeyInput): number {
  let value = 1;
  if (input.shift) value += 1;
  if (input.alt) value += 2;
  if (input.ctrl) value += 4;
  if (input.meta) value += 8;
  return value;
}

function applyAltPrefix(sequence: string, input: TerminalKeyInput): string {
  return input.alt ? `\x1b${sequence}` : sequence;
}

function ctrlSymbolCode(char: string): string | null {
  switch (char) {
    case " ":
    case "@":
    case "2":
      return "\x00";
    case "[":
    case "3":
      return "\x1b";
    case "\\":
    case "4":
      return "\x1c";
    case "]":
    case "5":
      return "\x1d";
    case "^":
    case "6":
      return "\x1e";
    case "_":
    case "/":
    case "7":
      return "\x1f";
    case "8":
    case "?":
      return "\x7f";
    default:
      return null;
  }
}

function encodeCtrlChar(char: string, input: TerminalKeyInput): string {
  const upper = char.toUpperCase();
  if (upper.length === 1 && upper >= "A" && upper <= "Z") {
    return applyAltPrefix(String.fromCharCode(upper.charCodeAt(0) - 64), input);
  }
  const symbol = ctrlSymbolCode(char);
  if (symbol !== null) {
    return applyAltPrefix(symbol, input);
  }
  if (char.length === 1) {
    return applyAltPrefix(String.fromCharCode(char.charCodeAt(0) & 0x1f), input);
  }
  return applyAltPrefix(char, input);
}

function encodePrintableKey(input: TerminalKeyInput): string {
  const char = input.shift ? input.key.toUpperCase() : input.key;
  return input.ctrl ? encodeCtrlChar(char, input) : applyAltPrefix(char, input);
}

function csiWithModifier(finalByte: string, input: TerminalKeyInput): string {
  const mod = modifierParam(input);
  return mod === 1 ? `\x1b[${finalByte}` : `\x1b[1;${mod}${finalByte}`;
}

function csiTilde(base: number, input: TerminalKeyInput): string {
  const mod = modifierParam(input);
  return mod === 1 ? `\x1b[${base}~` : `\x1b[${base};${mod}~`;
}

/**
 * Arrows move between two encodings depending on DECCKM, which full-screen
 * applications set so arrows stop colliding with cursor-address sequences.
 * Sending the wrong one makes arrows silently do nothing inside those programs.
 */
function encodeArrowKey(finalByte: string, input: TerminalKeyInput, options: TerminalKeyInputEncodingOptions): string {
  if (options.inputMode?.applicationCursorKeys) {
    return modifierParam(input) === 1 ? `\x1bO${finalByte}` : csiWithModifier(finalByte, input);
  }
  return csiWithModifier(finalByte, input);
}

function encodeNavigationKey(
  key: string,
  input: TerminalKeyInput,
  options: TerminalKeyInputEncodingOptions,
): string | null {
  switch (key) {
    case "ArrowUp":
      return encodeArrowKey("A", input, options);
    case "ArrowDown":
      return encodeArrowKey("B", input, options);
    case "ArrowRight":
      return encodeArrowKey("C", input, options);
    case "ArrowLeft":
      return encodeArrowKey("D", input, options);
    case "Home":
      return csiWithModifier("H", input);
    case "End":
      return csiWithModifier("F", input);
    case "Insert":
      return csiTilde(2, input);
    case "Delete":
      return csiTilde(3, input);
    case "PageUp":
      return csiTilde(5, input);
    case "PageDown":
      return csiTilde(6, input);
    default:
      return null;
  }
}

export function encodeTerminalKeyInput(
  input: TerminalKeyInput,
  options: TerminalKeyInputEncodingOptions = {},
): string {
  const key = input.key;
  if (!key) {
    return "";
  }

  if (key.length === 1) {
    return encodePrintableKey(input);
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      // Shift-Tab is its own sequence rather than a modified Tab.
      return input.shift && !input.ctrl && !input.alt && !input.meta
        ? "\x1b[Z"
        : applyAltPrefix("\t", input);
    case "Backspace":
      return applyAltPrefix("\x7f", input);
    case "Escape":
      return "\x1b";
    default:
      return encodeNavigationKey(key, input, options) ?? "";
  }
}

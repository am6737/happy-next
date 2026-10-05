import { Platform } from "react-native";

/**
 * A terminal needs a font where every glyph advances by the same amount — the
 * renderer positions runs by column count, not by measuring text, so a
 * proportional face would drift out of alignment with the cursor and with
 * full-screen TUIs.
 *
 * Menlo and monospace are the only monospaced families guaranteed to be
 * installed on each platform, so the choice is a constant rather than a stack.
 */
export const TERMINAL_FONT_FAMILY =
  Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) ?? "monospace";

export const DEFAULT_TERMINAL_FONT_SIZE = 13;

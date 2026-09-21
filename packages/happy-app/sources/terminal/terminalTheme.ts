import type { ITheme } from '@xterm/headless';

/**
 * ANSI palettes for the terminal renderer.
 *
 * The app's own `theme.colors.terminal` block is for rendering an agent's
 * captured command output, not a live screen — it has no ANSI palette and no
 * cursor colour, so it cannot drive xterm. These are separate on purpose.
 *
 * Layout follows xterm's `ITheme`: the eight base colours, their bright
 * variants, and the three defaults. A cell's `fgMode`/`bgMode` decides whether
 * it resolves against a palette index (these), a packed RGB value, or the
 * default foreground/background.
 */
export type TerminalColorScheme = 'light' | 'dark';

const DARK: ITheme = {
    background: '#1E1E1E',
    foreground: '#E0E0E0',
    cursor: '#E0E0E0',
    cursorAccent: '#1E1E1E',
    selection: '#3A3D41',
    black: '#282C34',
    red: '#E06C75',
    green: '#98C379',
    yellow: '#E5C07B',
    blue: '#61AFEF',
    magenta: '#C678DD',
    cyan: '#56B6C2',
    white: '#ABB2BF',
    brightBlack: '#5C6370',
    brightRed: '#E06C75',
    brightGreen: '#98C379',
    brightYellow: '#E5C07B',
    brightBlue: '#61AFEF',
    brightMagenta: '#C678DD',
    brightCyan: '#56B6C2',
    brightWhite: '#FFFFFF',
};

const LIGHT: ITheme = {
    background: '#FFFFFF',
    foreground: '#24292F',
    cursor: '#24292F',
    cursorAccent: '#FFFFFF',
    selection: '#B4D8FE',
    black: '#24292F',
    red: '#CF222E',
    green: '#116329',
    yellow: '#4D2D00',
    blue: '#0969DA',
    magenta: '#8250DF',
    cyan: '#1B7C83',
    white: '#6E7781',
    brightBlack: '#57606A',
    brightRed: '#A40E26',
    brightGreen: '#1A7F37',
    brightYellow: '#633C01',
    brightBlue: '#218BFF',
    brightMagenta: '#A475F9',
    brightCyan: '#3192AA',
    brightWhite: '#8C959F',
};

export const TERMINAL_THEMES: Record<TerminalColorScheme, ITheme> = {
    light: LIGHT,
    dark: DARK,
};

export function resolveTerminalTheme(scheme: TerminalColorScheme): ITheme {
    return TERMINAL_THEMES[scheme];
}

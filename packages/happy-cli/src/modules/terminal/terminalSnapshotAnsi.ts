/**
 * Renders a screen snapshot back down to terminal output.
 *
 * A client that draws the screen itself runs its own emulator, and emulators do
 * not expose "set the grid" — the only way to seed one is to feed it output. So
 * an attaching client is sent this instead of cells: the same screen expressed
 * as escape sequences, which it replays into its mirror.
 *
 * Ported from Paseo (https://github.com/getpaseo/paseo), Apache-2.0.
 * Copyright (c) 2025-present Mohamed Boudra.
 */

import type { TerminalCell, TerminalState } from 'happy-wire';

interface TerminalStyle {
    fg: number | undefined;
    bg: number | undefined;
    fgMode: number | undefined;
    bgMode: number | undefined;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    dim: boolean;
    inverse: boolean;
    strikethrough: boolean;
}

const DEFAULT_STYLE: TerminalStyle = {
    fg: undefined,
    bg: undefined,
    fgMode: undefined,
    bgMode: undefined,
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false,
    strikethrough: false,
};

const ANSI_PALETTE_MODE = 1;
const INDEXED_PALETTE_MODE = 2;
const RGB_MODE = 3;

export function renderTerminalStateToAnsi(state: TerminalState): string {
    // Autowrap off: a row that exactly fills the width must not spill onto the
    // next one, or every full row would land one line lower than it belongs.
    const parts: string[] = ['[?7l'];

    for (let row = 0; row < state.grid.length; row += 1) {
        parts.push(renderRow(state.grid[row] ?? []));
        if (row < state.grid.length - 1) {
            parts.push('\r\n');
        }
    }

    parts.push('[0m');
    const cursorPresentation = renderCursorPresentation(state);
    if (cursorPresentation) {
        parts.push(cursorPresentation);
    }
    parts.push(`[${state.cursor.row + 1};${state.cursor.col + 1}H`);
    parts.push(state.cursor.hidden ? '[?25l' : '[?25h');
    parts.push('[?7h');

    return parts.join('');
}

function renderCursorPresentation(state: TerminalState): string | null {
    const style = state.cursor.style;
    if (!style) {
        return null;
    }

    // DECSCUSR: 1/2 block, 3/4 underline, 5/6 bar — even codes mean steady.
    const blinking = state.cursor.blink !== false;
    const base = style === 'block' ? 1 : style === 'underline' ? 3 : 5;
    return `[${blinking ? base : base + 1} q`;
}

/**
 * One row of cells as escape sequences.
 *
 * Trailing blank cells are dropped so a mostly-empty screen does not pay for
 * every column, but a row that carries trailing *styling* keeps its full width —
 * a coloured background that stops early is a visible difference, not a saving.
 */
function renderRow(row: TerminalCell[]): string {
    const output: string[] = [];
    let previousStyle = DEFAULT_STYLE;

    for (let col = 0; col < significantRowLength(row); col += 1) {
        const cell = row[col] ?? { char: ' ' };
        const nextStyle = cellStyle(cell);
        if (!sameStyle(previousStyle, nextStyle)) {
            output.push(styleToAnsi(nextStyle));
            previousStyle = nextStyle;
        }
        output.push(cell.char || ' ');
    }

    if (!sameStyle(previousStyle, DEFAULT_STYLE)) {
        output.push('[0m');
    }

    return output.join('');
}

function significantRowLength(row: TerminalCell[]): number {
    for (let col = row.length - 1; col >= 0; col -= 1) {
        const cell = row[col];
        if (!cell) {
            continue;
        }
        if (cell.char !== ' ' || !sameStyle(cellStyle(cell), DEFAULT_STYLE)) {
            return col + 1;
        }
    }
    return 0;
}

function cellStyle(cell: TerminalCell): TerminalStyle {
    return {
        fg: cell.fg,
        bg: cell.bg,
        fgMode: cell.fgMode,
        bgMode: cell.bgMode,
        bold: Boolean(cell.bold),
        italic: Boolean(cell.italic),
        underline: Boolean(cell.underline),
        dim: Boolean(cell.dim),
        inverse: Boolean(cell.inverse),
        strikethrough: Boolean(cell.strikethrough),
    };
}

function sameStyle(left: TerminalStyle, right: TerminalStyle): boolean {
    return (
        left.fg === right.fg &&
        left.bg === right.bg &&
        left.fgMode === right.fgMode &&
        left.bgMode === right.bgMode &&
        left.bold === right.bold &&
        left.italic === right.italic &&
        left.underline === right.underline &&
        left.dim === right.dim &&
        left.inverse === right.inverse &&
        left.strikethrough === right.strikethrough
    );
}

/** A full reset plus the attributes this style needs — no incremental patching. */
function styleToAnsi(style: TerminalStyle): string {
    const codes = ['0'];

    if (style.bold) codes.push('1');
    if (style.dim) codes.push('2');
    if (style.italic) codes.push('3');
    if (style.underline) codes.push('4');
    if (style.inverse) codes.push('7');
    if (style.strikethrough) codes.push('9');

    if (style.fg !== undefined && style.fgMode !== undefined) {
        codes.push(...colorToSgr(style.fgMode, style.fg, false));
    }
    if (style.bg !== undefined && style.bgMode !== undefined) {
        codes.push(...colorToSgr(style.bgMode, style.bg, true));
    }

    return `[${codes.join(';')}m`;
}

function colorToSgr(mode: number, value: number, background: boolean): string[] {
    if (mode === ANSI_PALETTE_MODE) {
        if (value >= 8) {
            return [String((background ? 100 : 90) + (value - 8))];
        }
        return [String((background ? 40 : 30) + value)];
    }

    if (mode === INDEXED_PALETTE_MODE) {
        return [background ? '48' : '38', '5', String(value)];
    }

    if (mode === RGB_MODE) {
        return [
            background ? '48' : '38',
            '2',
            String((value >> 16) & 0xff),
            String((value >> 8) & 0xff),
            String(value & 0xff),
        ];
    }

    return [];
}

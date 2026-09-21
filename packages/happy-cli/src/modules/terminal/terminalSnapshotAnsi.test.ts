import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import type { TerminalCell, TerminalState } from 'happy-wire';
import { renderTerminalStateToAnsi } from './terminalSnapshotAnsi';

const ROWS = 4;
const COLS = 20;

function blankRow(): TerminalCell[] {
    return Array.from({ length: COLS }, () => ({ char: ' ' }));
}

function stateWith(row: TerminalCell[], cursor = { row: 0, col: 0 }): TerminalState {
    return {
        rows: ROWS,
        cols: COLS,
        grid: [row, blankRow(), blankRow(), blankRow()],
        cursor,
    };
}

interface Replayed {
    terminal: Terminal;
    chars(col: number): string | undefined;
    fgMode(col: number): number | undefined;
    fg(col: number): number | undefined;
    bgMode(col: number): number | undefined;
    bg(col: number): number | undefined;
    bold(col: number): boolean;
    italic(col: number): boolean;
    underline(col: number): boolean;
    rowText(row: number): string;
    line(row: number): ReturnType<Terminal['buffer']['active']['getLine']>;
}

/**
 * Renders a state to ANSI, replays it into a fresh emulator, and exposes what
 * that emulator ended up holding. Asserting on the replay rather than on the
 * escape string is what makes these tests meaningful: the string only has to be
 * right in the sense that a real terminal reads it back correctly.
 */
async function replay(state: TerminalState): Promise<Replayed> {
    const terminal = new Terminal({ rows: ROWS, cols: COLS, allowProposedApi: true });
    await new Promise<void>((resolve) =>
        terminal.write(renderTerminalStateToAnsi(state), () => resolve()),
    );

    const at = (row: number, col: number) => terminal.buffer.active.getLine(row)?.getCell(col);
    const mode = (value: number | undefined) => (value === undefined ? undefined : value >> 24);
    const flag = (value: number | undefined) => value !== undefined && value !== 0;

    return {
        terminal,
        chars: (col) => at(0, col)?.getChars(),
        fgMode: (col) => mode(at(0, col)?.getFgColorMode()),
        fg: (col) => at(0, col)?.getFgColor(),
        bgMode: (col) => mode(at(0, col)?.getBgColorMode()),
        bg: (col) => at(0, col)?.getBgColor(),
        bold: (col) => flag(at(0, col)?.isBold()),
        italic: (col) => flag(at(0, col)?.isItalic()),
        underline: (col) => flag(at(0, col)?.isUnderline()),
        rowText: (row) => terminal.buffer.active.getLine(row)?.translateToString(true).trim() ?? '',
        line: (row) => terminal.buffer.active.getLine(row),
    };
}

describe('renderTerminalStateToAnsi', () => {
    it('round-trips a basic ANSI colour', async () => {
        const row = blankRow();
        row[0] = { char: 'X', fg: 1, fgMode: 1 };
        const replayed = await replay(stateWith(row));

        expect(replayed.chars(0)).toBe('X');
        expect(replayed.fgMode(0)).toBe(1);
        expect(replayed.fg(0)).toBe(1);
        replayed.terminal.dispose();
    });

    it('round-trips a bright ANSI colour', async () => {
        const row = blankRow();
        row[0] = { char: 'X', fg: 9, fgMode: 1 };
        const replayed = await replay(stateWith(row));

        expect(replayed.fg(0)).toBe(9);
        replayed.terminal.dispose();
    });

    it('round-trips an indexed 256 colour', async () => {
        const row = blankRow();
        row[0] = { char: 'X', fg: 196, fgMode: 2 };
        const replayed = await replay(stateWith(row));

        expect(replayed.fgMode(0)).toBe(2);
        expect(replayed.fg(0)).toBe(196);
        replayed.terminal.dispose();
    });

    it('round-trips a packed RGB colour', async () => {
        const row = blankRow();
        const rgb = (10 << 16) | (20 << 8) | 30;
        row[0] = { char: 'X', fg: rgb, fgMode: 3 };
        const replayed = await replay(stateWith(row));

        expect(replayed.fgMode(0)).toBe(3);
        expect(replayed.fg(0)).toBe(rgb);
        replayed.terminal.dispose();
    });

    it('round-trips a background colour', async () => {
        const row = blankRow();
        row[0] = { char: 'X', bg: 4, bgMode: 1 };
        const replayed = await replay(stateWith(row));

        expect(replayed.bgMode(0)).toBe(1);
        expect(replayed.bg(0)).toBe(4);
        replayed.terminal.dispose();
    });

    it('round-trips bold, italic and underline', async () => {
        const row = blankRow();
        row[0] = { char: 'B', bold: true };
        row[1] = { char: 'I', italic: true };
        row[2] = { char: 'U', underline: true };
        const replayed = await replay(stateWith(row));

        expect(replayed.bold(0)).toBe(true);
        expect(replayed.italic(1)).toBe(true);
        expect(replayed.underline(2)).toBe(true);
        replayed.terminal.dispose();
    });

    it('restores the cursor position', async () => {
        const replayed = await replay(stateWith(blankRow(), { row: 2, col: 7 }));

        expect(replayed.terminal.buffer.active.cursorY).toBe(2);
        expect(replayed.terminal.buffer.active.cursorX).toBe(7);
        replayed.terminal.dispose();
    });

    it('keeps text on the row it was captured from', async () => {
        const row = blankRow();
        row[0] = { char: 'A' };
        const second = blankRow();
        second[0] = { char: 'B' };
        const state = stateWith(row);
        state.grid[1] = second;

        const replayed = await replay(state);

        expect(replayed.rowText(0)).toBe('A');
        expect(replayed.rowText(1)).toBe('B');
        replayed.terminal.dispose();
    });

    it('does not wrap a row that exactly fills the width', async () => {
        // Autowrap left on would push the last character of a full row onto the
        // next line, shifting everything below it down by one.
        const row = Array.from({ length: COLS }, (_, col) => ({ char: String(col % 10) }));
        const second = blankRow();
        second[0] = { char: 'Z' };
        const state = stateWith(row);
        state.grid[1] = second;

        const replayed = await replay(state);

        expect(replayed.line(0)?.isWrapped).toBe(false);
        expect(replayed.rowText(1)).toBe('Z');
        replayed.terminal.dispose();
    });
});

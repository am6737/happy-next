import { describe, expect, it } from 'vitest';
import { encodeTerminalKeyInput, type TerminalInputModeState } from './terminalKeyInput';

const NORMAL_MODE: TerminalInputModeState = {
    applicationCursorKeys: false,
    bracketedPaste: false,
};

const APPLICATION_MODE: TerminalInputModeState = {
    applicationCursorKeys: true,
    bracketedPaste: false,
};

function encode(key: string, input: Partial<Parameters<typeof encodeTerminalKeyInput>[0]> = {}, inputMode = NORMAL_MODE) {
    return encodeTerminalKeyInput({ key, ...input }, { inputMode });
}

describe('encodeTerminalKeyInput', () => {
    it('passes printable characters through', () => {
        expect(encode('a')).toBe('a');
        expect(encode('7')).toBe('7');
        expect(encode(' ')).toBe(' ');
    });

    it('upper-cases a shifted character', () => {
        expect(encode('a', { shift: true })).toBe('A');
    });

    it('turns control chords into control codes', () => {
        expect(encode('c', { ctrl: true })).toBe('\x03');
        expect(encode('a', { ctrl: true })).toBe('\x01');
        expect(encode('z', { ctrl: true })).toBe('\x1a');
    });

    it('maps the control chords that are not letters', () => {
        expect(encode('[', { ctrl: true })).toBe('\x1b');
        expect(encode('\\', { ctrl: true })).toBe('\x1c');
        expect(encode(' ', { ctrl: true })).toBe('\x00');
        expect(encode('?', { ctrl: true })).toBe('\x7f');
    });

    it('prefixes alt with escape', () => {
        expect(encode('x', { alt: true })).toBe('\x1bx');
    });

    it('encodes the editing keys', () => {
        expect(encode('Enter')).toBe('\r');
        expect(encode('Tab')).toBe('\t');
        expect(encode('Backspace')).toBe('\x7f');
        expect(encode('Escape')).toBe('\x1b');
    });

    it('encodes shift-tab as its own sequence', () => {
        expect(encode('Tab', { shift: true })).toBe('\x1b[Z');
    });

    it('encodes arrows with CSI when application cursor mode is off', () => {
        expect(encode('ArrowUp')).toBe('\x1b[A');
        expect(encode('ArrowDown')).toBe('\x1b[B');
        expect(encode('ArrowRight')).toBe('\x1b[C');
        expect(encode('ArrowLeft')).toBe('\x1b[D');
    });

    it('encodes arrows with SS3 when application cursor mode is on', () => {
        // Full-screen programs set DECCKM and then only recognise these forms;
        // sending CSI to them makes the arrow keys do nothing.
        expect(encode('ArrowUp', {}, APPLICATION_MODE)).toBe('\x1bOA');
        expect(encode('ArrowLeft', {}, APPLICATION_MODE)).toBe('\x1bOD');
    });

    it('keeps a modified arrow on CSI even in application mode', () => {
        expect(encode('ArrowUp', { ctrl: true }, APPLICATION_MODE)).toBe('\x1b[1;5A');
    });

    it('encodes modified arrows with the xterm modifier parameter', () => {
        expect(encode('ArrowUp', { shift: true })).toBe('\x1b[1;2A');
        expect(encode('ArrowRight', { ctrl: true })).toBe('\x1b[1;5C');
        expect(encode('ArrowDown', { alt: true })).toBe('\x1b[1;3B');
    });

    it('encodes the tilde-terminated navigation keys', () => {
        expect(encode('PageUp')).toBe('\x1b[5~');
        expect(encode('PageDown')).toBe('\x1b[6~');
        expect(encode('Delete')).toBe('\x1b[3~');
        expect(encode('Insert')).toBe('\x1b[2~');
    });

    it('encodes home and end', () => {
        expect(encode('Home')).toBe('\x1b[H');
        expect(encode('End')).toBe('\x1b[F');
    });

    it('returns nothing for a key it cannot express', () => {
        expect(encode('')).toBe('');
        expect(encode('F13')).toBe('');
        expect(encode('SomeUnmappedKey')).toBe('');
    });
});

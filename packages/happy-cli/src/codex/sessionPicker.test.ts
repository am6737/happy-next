import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { CodexSessionPicker } from './sessionPicker';
import { describe, expect, it, vi } from 'vitest';
import { formatSessionAge, pickerPageSize, pickerWindow, sanitizeSessionPickerText } from './sessionPicker';

describe('Codex session picker viewport', () => {
  it('bounds rows by terminal height and a compact maximum', () => {
    expect(pickerPageSize(40)).toBe(25);
    expect(pickerPageSize(12)).toBe(6);
    expect(pickerPageSize(6)).toBe(1);
  });
  it('renders only the first screen of a large list', () => {
    expect(pickerWindow(500, 0, 0, 12)).toEqual({ selected: 0, start: 0, end: 12 });
  });
  it('scrolls only when moving outside the visible range', () => {
    expect(pickerWindow(500, 11, 0, 12)).toEqual({ selected: 11, start: 0, end: 12 });
    expect(pickerWindow(500, 12, 0, 12)).toEqual({ selected: 12, start: 1, end: 13 });
    expect(pickerWindow(500, 8, 10, 12)).toEqual({ selected: 8, start: 8, end: 20 });
  });
  it('handles page moves and both list boundaries without wrapping', () => {
    expect(pickerWindow(30, 24, 1, 12)).toEqual({ selected: 24, start: 13, end: 25 });
    expect(pickerWindow(30, 200, 13, 12)).toEqual({ selected: 29, start: 18, end: 30 });
    expect(pickerWindow(30, -12, 18, 12)).toEqual({ selected: 0, start: 0, end: 12 });
  });
  it('keeps the selected row visible after terminal resize', () => {
    expect(pickerWindow(50, 11, 0, 4)).toEqual({ selected: 11, start: 8, end: 12 });
    expect(pickerWindow(50, 49, 48, 12)).toEqual({ selected: 49, start: 38, end: 50 });
  });
  it('handles empty and short lists', () => {
    expect(pickerWindow(0, 0, 0, 12)).toEqual({ selected: 0, start: 0, end: 0 });
    expect(pickerWindow(1, 10, 0, 12)).toEqual({ selected: 0, start: 0, end: 1 });
  });
  it('strips terminal control characters without damaging Unicode titles', () => {
    expect(sanitizeSessionPickerText('\x1b[31m你好👋\nnext\r\t\u009b\u2028end')).toBe('[31m你好👋 next    end');
  });
  it('formats relative timestamps and invalid dates', () => {
    const now = 100 * 86400_000;
    expect(formatSessionAge(undefined, now)).toBe('unknown');
    expect(formatSessionAge(NaN, now)).toBe('unknown');
    expect(formatSessionAge(now + 1000, now)).toBe('now');
    expect(formatSessionAge(now - 120_000, now)).toBe('2m ago');
    expect(formatSessionAge(now - 3600_000, now)).toBe('1h ago');
    expect(formatSessionAge(now - 86400_000, now)).toBe('1d ago');
  });
});


describe('Codex session picker keyboard interaction', () => {
  function mount(rows = 11, count = 30) {
    const input = Object.assign(new PassThrough(), {
      isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn(),
    });
    const output = Object.assign(new PassThrough(), { columns: 60, rows, isTTY: true });
    let frame = '';
    output.on('data', chunk => { frame += chunk.toString(); });
    const sessions = Array.from({ length: count }, (_, index) => ({
      sessionId: 'sameid', // Selection must use the actual record, not short ID.
      sessionFile: `/sessions/${index}.jsonl`,
      originalPath: `/repo/${index}`,
      title: `Conversation-${index}`,
    }));
    const select = vi.fn();
    const app = render(React.createElement(CodexSessionPicker, { sessions, onSelect: select }), {
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
      debug: true, exitOnCtrlC: false, patchConsole: false,
    });
    return { input, output, select, app, text: () => frame, clear: () => { frame = ''; } };
  }

  it('limits rendering, handles arrows/pages/resize, and returns the exact selected file', async () => {
    const view = mount();
    try {
      await vi.waitFor(() => expect(view.text()).toContain('Conversation-4'));
      expect(view.text()).not.toContain('Conversation-5');
      expect(view.text()).toContain('n/p page');
      expect(view.text()).not.toContain('PgUp/PgDn');
      view.input.write('\x1b[B');
      await vi.waitFor(() => expect(view.text()).toContain('2 / 30'));
      view.input.write('\x1b[6~');
      await vi.waitFor(() => expect(view.text()).toContain('7 / 30'));
      view.output.rows = 9;
      view.output.emit('resize');
      await vi.waitFor(() => expect(view.text()).toContain('Showing 6–8'));
      view.input.write('\x1b[5~');
      await vi.waitFor(() => expect(view.text()).toContain('4 / 30'));
      view.input.write('\r');
      await view.app.waitUntilExit();
      expect(view.select).toHaveBeenCalledOnce();
      expect(view.select.mock.calls[0][0].sessionFile).toBe('/sessions/3.jsonl');
      expect(view.input.setRawMode).toHaveBeenLastCalledWith(false);
    } finally { view.app.unmount(); view.app.cleanup(); view.input.destroy(); view.output.destroy(); }
  });

  it.each([
    { next: '\x1b[6~', previous: '\x1b[5~' },
    { next: 'n', previous: 'p' },
  ])('moves an entire viewport using $next / $previous', async keys => {
    const view = mount();
    try {
      await vi.waitFor(() => expect(view.text()).toContain('Showing 1–5'));
      view.input.write(keys.next);
      await vi.waitFor(() => expect(view.text()).toContain('Showing 6–10'));
      view.input.write(keys.next);
      await vi.waitFor(() => expect(view.text()).toContain('Showing 11–15'));
      view.clear();
      view.input.write(keys.previous);
      await vi.waitFor(() => expect(view.text()).toContain('6 / 30 · Showing 6–10'));
      view.input.write('\r');
      await view.app.waitUntilExit();
      expect(view.select.mock.calls[0][0].sessionFile).toBe('/sessions/5.jsonl');
    } finally { view.app.unmount(); view.app.cleanup(); view.input.destroy(); view.output.destroy(); }
  });

  it('caps tall terminals at 25 rows and uses the resized viewport for paging', async () => {
    const view = mount(50, 60);
    try {
      await vi.waitFor(() => expect(view.text()).toContain('Showing 1–25'));
      expect(view.text()).toContain('Conversation-24');
      expect(view.text()).not.toContain('Conversation-25');
      view.input.write('n');
      await vi.waitFor(() => expect(view.text()).toContain('26 / 60 · Showing 26–50'));
      view.clear();
      view.output.rows = 16;
      view.output.emit('resize');
      await vi.waitFor(() => expect(view.text()).toContain('Showing 26–35'));
      view.input.write('n');
      await vi.waitFor(() => expect(view.text()).toContain('36 / 60 · Showing 36–45'));
      view.input.write('\r');
      await view.app.waitUntilExit();
      expect(view.select.mock.calls[0][0].sessionFile).toBe('/sessions/35.jsonl');
    } finally { view.app.unmount(); view.app.cleanup(); view.input.destroy(); view.output.destroy(); }
  });

  it.each(['q', '\x1b', '\x03'])('cancels with %j and restores terminal input', async key => {
    const view = mount();
    try {
      await vi.waitFor(() => expect(view.input.setRawMode).toHaveBeenCalledWith(true));
      view.input.write(key);
      await view.app.waitUntilExit();
      expect(view.select).toHaveBeenCalledExactlyOnceWith(null);
      expect(view.input.setRawMode).toHaveBeenLastCalledWith(false);
    } finally { view.app.unmount(); view.app.cleanup(); view.input.destroy(); view.output.destroy(); }
  });
});

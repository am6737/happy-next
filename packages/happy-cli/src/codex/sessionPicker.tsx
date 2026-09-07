import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import type { ResumeSession } from './cli';

// Keep the picker compact even on very tall terminals. Leave room for chrome
// and a spare terminal line to avoid scrolling the surrounding shell output.
export function pickerPageSize(terminalRows: number): number {
  return Math.max(1, Math.min(25, terminalRows - 6));
}

export function pickerWindow(count: number, selected: number, start: number, size: number) {
  const index = Math.max(0, Math.min(selected, count - 1));
  const length = Math.max(1, size);
  const first = Math.max(0, Math.min(start, index, Math.max(0, count - length)));
  const top = index >= first + length ? index - length + 1 : first;
  return { selected: index, start: top, end: Math.min(count, top + length) };
}

export function sanitizeSessionPickerText(value: string): string {
  // Session text must never inject terminal escape sequences or extra rows.
  return value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').trim();
}

export function formatSessionAge(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined || !Number.isFinite(updatedAt)) return 'unknown';
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CodexSessionPicker({ sessions, onSelect }: {
  sessions: readonly ResumeSession[];
  onSelect: (session: ResumeSession | null) => void;
}) {
  const { stdout } = useStdout();
  const { exit } = useApp();
  const [dimensions, setDimensions] = useState(() => ({ rows: stdout.rows || 24, columns: stdout.columns || 80 }));
  const [position, setPosition] = useState({ selected: 0, start: 0 });
  const [now] = useState(Date.now);
  const finished = useRef(false);
  const size = pickerPageSize(dimensions.rows);
  const window = pickerWindow(sessions.length, position.selected, position.start, size);

  useEffect(() => {
    const resize = () => setDimensions({ rows: stdout.rows || 24, columns: stdout.columns || 80 });
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);

  useInput((input, key) => {
    if (finished.current) return;
    if (key.return || key.escape || input.toLowerCase() === 'q' || (key.ctrl && input === 'c')) {
      finished.current = true;
      onSelect(key.return ? sessions[window.selected] ?? null : null);
      exit();
      return;
    }
    const pageUp = key.pageUp || input === 'p';
    const pageDown = key.pageDown || input === 'n';
    const paging = pageUp || pageDown;
    const delta = pageUp ? -size : pageDown ? size : key.upArrow ? -1 : key.downArrow ? 1 : 0;
    if (delta || key.home || key.end) {
      setPosition(previous => {
        const visible = pickerWindow(sessions.length, previous.selected, previous.start, size);
        const target = key.home ? 0 : key.end ? sessions.length - 1 : visible.selected + delta;
        // Page keys move the viewport as well as the selection. Arrow keys only
        // scroll when the selected row leaves the current viewport.
        const start = paging ? visible.start + delta : visible.start;
        return pickerWindow(sessions.length, target, start, size);
      });
    }
  });

  const selected = sessions[window.selected];
  const directory = sanitizeSessionPickerText(selected?.originalPath || 'unknown directory');
  return (
    <Box flexDirection="column" width={Math.max(1, dimensions.columns)}>
      <Text bold wrap="truncate-end">Resume a Codex session</Text>
      <Text dimColor wrap="truncate-end">
        {sessions.length ? `${window.selected + 1} / ${sessions.length} · Showing ${window.start + 1}–${window.end}` : 'No sessions'}
      </Text>
      {sessions.slice(window.start, window.end).map((session, offset) => {
        const active = window.start + offset === window.selected;
        const title = sanitizeSessionPickerText(session.title || '') || 'Untitled session';
        const id = sanitizeSessionPickerText(session.sessionId).slice(0, 6);
        return (
          <Text key={session.sessionFile} color={active ? 'cyan' : undefined} inverse={active} wrap="truncate-end">
            {active ? '› ' : '  '}{formatSessionAge(session.updatedAt, now).padEnd(8)} {id}  {title}
          </Text>
        );
      })}
      <Text dimColor wrap="truncate-middle">Directory: {directory}</Text>
      <Text dimColor wrap="truncate-end">↑/↓ select · n/p page · Enter resume · q cancel</Text>
    </Box>
  );
}

export async function selectCodexSession(sessions: readonly ResumeSession[]): Promise<ResumeSession | null> {
  if (!sessions.length) return null;
  let selected: ResumeSession | null = null;
  const app = render(<CodexSessionPicker sessions={sessions} onSelect={value => { selected = value; }} />, {
    exitOnCtrlC: false,
    patchConsole: false,
  });
  try {
    await app.waitUntilExit();
    return selected;
  } finally {
    app.unmount();
    app.cleanup();
  }
}

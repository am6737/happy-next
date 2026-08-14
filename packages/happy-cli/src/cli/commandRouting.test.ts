import { describe, expect, it } from 'vitest';
import {
  PUBLIC_DAEMON_SUBCOMMANDS,
  resolveCliInvocation,
  suggestClosestCommand,
} from './commandRouting';

describe('resolveCliInvocation', () => {
  it('starts Claude when no arguments are provided', () => {
    expect(resolveCliInvocation([])).toEqual({
      kind: 'claude',
      args: [],
      passthrough: false,
    });
  });

  it('keeps the direct Claude option shortcut', () => {
    expect(resolveCliInvocation(['--resume'])).toEqual({
      kind: 'claude',
      args: ['--resume'],
      passthrough: false,
    });
  });

  it('accepts explicit Claude positional arguments', () => {
    expect(resolveCliInvocation(['claude', 'fix the tests'])).toEqual({
      kind: 'claude',
      args: ['fix the tests'],
      passthrough: false,
    });
  });

  it('accepts the standard argument separator for Claude positional arguments', () => {
    expect(resolveCliInvocation(['--', 'fix', 'the', 'tests'])).toEqual({
      kind: 'claude',
      args: ['fix', 'the', 'tests'],
      passthrough: true,
    });
  });

  it('routes known Happy commands without changing their arguments', () => {
    expect(resolveCliInvocation(['daemon', 'start'])).toEqual({
      kind: 'happy-command',
      command: 'daemon',
    });
  });

  it('rejects a misspelled command and suggests the intended command', () => {
    expect(resolveCliInvocation(['deamon', 'start'])).toEqual({
      kind: 'unknown-command',
      command: 'deamon',
      suggestion: 'daemon',
    });
  });

  it('does not turn an arbitrary positional word into a Claude session', () => {
    expect(resolveCliInvocation(['review'])).toEqual({
      kind: 'unknown-command',
      command: 'review',
      suggestion: undefined,
    });
  });

  it('recognizes transposed letters when suggesting a command', () => {
    expect(resolveCliInvocation(['doctro'])).toMatchObject({
      kind: 'unknown-command',
      suggestion: 'doctor',
    });
  });
});

describe('suggestClosestCommand', () => {
  it('suggests daemon status for a close nested typo', () => {
    expect(suggestClosestCommand('stats', PUBLIC_DAEMON_SUBCOMMANDS)).toBe('status');
  });

  it('does not suggest unrelated nested commands', () => {
    expect(suggestClosestCommand('something-else', PUBLIC_DAEMON_SUBCOMMANDS)).toBeUndefined();
  });
});

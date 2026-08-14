import { describe, expect, it } from 'vitest';
import {
  addBuiltinSlashCommands,
  BUILTIN_SLASH_COMMANDS,
  expandBuiltinSlashCommand,
  PREVIEW_HTML_COMMAND_NAME,
} from './builtinCommands';

describe('built-in slash commands', () => {
  it('adds built-in slash commands without dropping existing capabilities', () => {
    const capabilities = addBuiltinSlashCommands({
      tools: ['Bash'],
      slashCommands: ['clear'],
      slashCommandMetadata: [{ name: 'clear', kind: 'command', scope: 'SYSTEM' }],
    });

    expect(capabilities.tools).toEqual(['Bash']);
    expect(capabilities.slashCommands).toEqual(['clear', ...BUILTIN_SLASH_COMMANDS]);
    expect(capabilities.slashCommandMetadata?.map((command) => command.name)).toEqual([
      'clear',
      PREVIEW_HTML_COMMAND_NAME,
    ]);
  });

  it('does not duplicate when applied twice', () => {
    const once = addBuiltinSlashCommands({});
    const twice = addBuiltinSlashCommands(once);
    expect(twice.slashCommands).toEqual([PREVIEW_HTML_COMMAND_NAME]);
    expect(twice.slashCommandMetadata).toHaveLength(1);
  });

  it('expands /preview-html with its argument into a preview_html prompt', () => {
    const expanded = expandBuiltinSlashCommand('/preview-html a bar chart of sales by month');

    expect(expanded?.name).toBe(PREVIEW_HTML_COMMAND_NAME);
    expect(expanded?.prompt).toContain('preview_html');
    expect(expanded?.prompt).toContain('a bar chart of sales by month');
    expect(expanded?.prompt).toContain('self-contained HTML');
  });

  it('expands /preview-html with no argument, guiding the model to use context', () => {
    const expanded = expandBuiltinSlashCommand('/preview-html');

    expect(expanded?.name).toBe(PREVIEW_HTML_COMMAND_NAME);
    expect(expanded?.prompt).toContain('current conversation context');
    expect(expanded?.prompt).not.toContain('$ARGUMENTS');
  });

  it('ignores non-matching messages', () => {
    expect(expandBuiltinSlashCommand('/clear')).toBeNull();
    expect(expandBuiltinSlashCommand('preview-html without slash')).toBeNull();
    expect(expandBuiltinSlashCommand('/preview-htmlish extra')).toBeNull();
  });
});

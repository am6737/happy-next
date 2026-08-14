/**
 * Built-in Happy slash commands that wrap always-available MCP tools.
 *
 * Unlike the orchestrator commands (which are gated to controller sessions), these are exposed in
 * every session because the tools they drive (`preview_html`) are registered unconditionally by the
 * Happy MCP server. Each command is model-mediated: the slash command expands into a prompt that
 * instructs the agent to call the underlying tool.
 *
 * Per-runner wiring:
 * - Claude discovers `~/.claude/commands/*.md` natively, so we only sync the command file
 *   (`syncBuiltinCommands`) and Claude expands `$ARGUMENTS` itself.
 * - Codex / Gemini have no file-based command discovery, so we register the command into
 *   SessionCapabilities (`addBuiltinSlashCommands`) and expand it in their message loops
 *   (`expandBuiltinSlashCommand`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SessionCapabilities } from '@/api/types';
import { logger } from '@/ui/logger';

export const PREVIEW_HTML_COMMAND_NAME = 'preview-html';

const PREVIEW_HTML_DESCRIPTION = 'Generate a self-contained HTML document and preview it in the app';

export function buildPreviewHtmlPrompt(input: string = '$ARGUMENTS'): string {
  const target = input.trim().length > 0
    ? input
    : '(no input given — use the current conversation context, or ask what to preview)';
  return `The user invoked /preview-html. Their input:

${target}

Produce a complete, self-contained HTML document — all CSS and JS inlined, no external network
resources — and call the \`preview_html\` tool with it so it renders in the client app.

- If the input is a path to an existing HTML file, read that file and preview its contents.
- Otherwise treat the input as a description/spec and build the page to match it.

Call \`preview_html\` with the finished document; do not just print the HTML back as text.`;
}

const PREVIEW_HTML_COMMAND_MD = `---
description: ${PREVIEW_HTML_DESCRIPTION}
argument-hint: [description or path to an .html file]
---


${buildPreviewHtmlPrompt()}
`;

export const BUILTIN_SLASH_COMMAND_METADATA = [
  {
    name: PREVIEW_HTML_COMMAND_NAME,
    description: PREVIEW_HTML_DESCRIPTION,
    kind: 'command' as const,
    scope: 'SYSTEM' as const,
  },
];

export const BUILTIN_SLASH_COMMANDS = BUILTIN_SLASH_COMMAND_METADATA.map((command) => command.name);

function mergeByName<T extends { name: string }>(existing: T[] | undefined, added: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of existing ?? []) byName.set(item.name, item);
  for (const item of added) byName.set(item.name, item);
  return Array.from(byName.values());
}

function mergeStrings(existing: string[] | undefined, added: readonly string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...added]));
}

export function addBuiltinSlashCommands(capabilities: SessionCapabilities): SessionCapabilities {
  return {
    ...capabilities,
    slashCommands: mergeStrings(capabilities.slashCommands, BUILTIN_SLASH_COMMANDS),
    slashCommandMetadata: mergeByName(
      capabilities.slashCommandMetadata,
      BUILTIN_SLASH_COMMAND_METADATA,
    ),
  };
}

export type ExpandedBuiltinSlashCommand = {
  name: string;
  prompt: string;
};

export function expandBuiltinSlashCommand(message: string): ExpandedBuiltinSlashCommand | null {
  const match = message.trim().match(/^\/preview-html(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  return {
    name: PREVIEW_HTML_COMMAND_NAME,
    prompt: buildPreviewHtmlPrompt(match[1]?.trim() ?? ''),
  };
}

let didSync = false;

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
    logger.debug(`[commands] synced built-in command: ${filePath}`);
  } catch (error) {
    logger.debug(`[commands] failed to sync ${filePath}: ${error}`);
  }
}

/**
 * Sync built-in command files into the Claude config dir so `/preview-html` is available natively.
 *
 * - Idempotent: written only when content differs (no churn).
 * - Best-effort: never throws — a failed write is logged and skipped.
 * - A provider's config dir is populated only if it already exists — we never create ~/.claude for a
 *   tool the user has not set up.
 * - Runs once per process. Not gated on orchestrator/controller status: these commands are for all
 *   sessions, matching the always-on `preview_html` MCP tool.
 */
export function syncBuiltinCommands(): void {
  if (didSync) return;
  didSync = true;

  const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  if (existsSync(claudeRoot)) {
    writeIfChanged(join(claudeRoot, 'commands', 'preview-html.md'), PREVIEW_HTML_COMMAND_MD);
  }
}

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('safe mode excludes a fake user MCP server from the actual Claude roster', () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-claude-fake-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: root };
  const run = (args: string[]) => execFileSync('claude', args, { env, cwd: root,
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    run(['mcp', 'add', '--scope', 'user', 'fake_probe', '--', 'false']);
    expect(run(['mcp', 'list'])).toContain('fake_probe');
    expect(run(['--safe-mode', 'mcp', 'list'])).not.toContain('fake_probe');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

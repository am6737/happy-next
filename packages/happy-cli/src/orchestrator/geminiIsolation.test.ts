import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('isolates a fake Gemini user MCP registry through GEMINI_CLI_HOME', () => {
  const source = mkdtempSync(join(tmpdir(), 'happy-gemini-fake-'));
  const target = mkdtempSync(join(tmpdir(), 'happy-gemini-isolated-'));
  const run = (home: string, args: string[]) => {
    const result = spawnSync('gemini', args, {
    env: { ...process.env, GEMINI_CLI_HOME: home }, cwd: source,
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(result.status, `${result.stdout}${result.stderr}`.slice(0, 500)).toBe(0);
    return `${result.stdout}${result.stderr}`;
  };
  try {
    run(source, ['mcp', 'add', '--scope', 'user', 'fake_probe', 'false']);
    expect(run(source, ['mcp', 'list'])).toContain('fake_probe');
    expect(run(target, ['mcp', 'list'])).not.toContain('fake_probe');
    mkdirSync(join(source, '.gemini'), { recursive: true });
    writeFileSync(join(source, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: {
      project_probe: { command: 'false' },
    } }));
    expect(run(source, ['mcp', 'list'])).toContain('project_probe');
    expect(run(target, ['mcp', 'list'])).not.toContain('project_probe');
  } finally { rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true }); }
}, 30_000);

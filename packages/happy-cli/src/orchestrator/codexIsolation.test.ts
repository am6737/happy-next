import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { cleanupIsolatedCodexAuth, safeCodexConfig, prepareIsolatedCodexHome } from './codexIsolation';

const original = process.env.CODEX_HOME;
afterEach(() => {
  if (original === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = original;
});

it('migrates only the exact legacy session bound to this worktree', () => {
  const source = mkdtempSync(join(tmpdir(), 'codex-session-fake-'));
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const worktree = join(source, 'worktree');
  const sessions = join(source, 'sessions', '2026', '10', '07');
  mkdirSync(sessions, { recursive: true });
  mkdirSync(worktree);
  const rollout = (id: string, cwd: string) => `${JSON.stringify({ type: 'session_meta', payload: { id, cwd } })}\n`;
  writeFileSync(join(sessions, `rollout-test-${sessionId}.jsonl`), rollout(sessionId, worktree));
  writeFileSync(join(sessions, `rollout-test-${otherId}.jsonl`), rollout(otherId, worktree));
  process.env.CODEX_HOME = source;
  let privatePath: string | undefined;
  try {
    const isolated = prepareIsolatedCodexHome(`migration-${Date.now()}`, worktree,
      { sessionId, worktree });
    privatePath = isolated.path;
    expect(readFileSync(join(privatePath, 'sessions', '2026', '10', '07',
      `rollout-test-${sessionId}.jsonl`), 'utf8')).toBe(rollout(sessionId, worktree));
    expect(() => readFileSync(join(privatePath!, 'sessions', '2026', '10', '07',
      `rollout-test-${otherId}.jsonl`))).toThrow();
    isolated.cleanup();
    expect(() => prepareIsolatedCodexHome(`wrong-${Date.now()}`, '/different',
      { sessionId, worktree: '/different' })).toThrow(/belongs to another workspace/);
  } finally {
    if (privatePath) rmSync(privatePath, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

it('excludes inherited MCP tools while preserving model provider and removes private auth copy', () => {
  const source = mkdtempSync(join(tmpdir(), 'codex-isolation-fake-'));
  const home = join(source, 'source');
  const project = join(source, 'project');
  mkdirSync(home);
  mkdirSync(join(project, '.codex'), { recursive: true });
  writeFileSync(join(project, '.codex', 'config.toml'), '[mcp_servers.project_probe]\ncommand = "false"\n');
  writeFileSync(join(home, 'config.toml'), 'model_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "https://example.invalid/v1"\nwire_api = "responses"\n[mcp_servers.probe]\ncommand = "false"\n');
  writeFileSync(join(home, 'auth.json'), '{"fixture":true}');
  process.env.CODEX_HOME = home;
  try {
    const safe = safeCodexConfig(join(home, 'config.toml'));
    expect(safe).toContain('model_provider = "fixture"');
    expect(safe).not.toContain('mcp_servers');
    const taskId = `fake-${Date.now()}`;
    const isolated = prepareIsolatedCodexHome(taskId, project);
    expect(readFileSync(join(isolated.path, 'config.toml'), 'utf8')).not.toContain('probe');
    const list = (codexHome: string, args: string[] = []) => execFileSync('codex', [...args, 'mcp', 'list'], {
      env: { ...process.env, CODEX_HOME: codexHome }, encoding: 'utf8', timeout: 15_000,
    });
    expect(list(home)).toContain('probe');
    expect(list(isolated.path)).not.toContain('probe');
    const leader = list(isolated.path, ['-c', 'mcp_servers.happy_leader={command="false"}']);
    expect(leader).toContain('happy_leader');
    expect(leader).not.toContain('probe');
    const member = list(isolated.path);
    expect(member).not.toContain('happy_leader');
    const projectMember = execFileSync('codex', ['mcp', 'list'], {
      cwd: project, env: { ...process.env, CODEX_HOME: isolated.path }, encoding: 'utf8', timeout: 15_000,
    });
    expect(projectMember).not.toContain('project_probe');
    expect(readFileSync(join(isolated.path, 'auth.json'), 'utf8')).toBe('{"fixture":true}');
    cleanupIsolatedCodexAuth('another-task');
    expect(readFileSync(join(isolated.path, 'auth.json'), 'utf8')).toBe('{"fixture":true}');
    cleanupIsolatedCodexAuth(taskId);
    expect(() => readFileSync(join(isolated.path, 'auth.json'))).toThrow();
  } finally { rmSync(source, { recursive: true, force: true }); }
});

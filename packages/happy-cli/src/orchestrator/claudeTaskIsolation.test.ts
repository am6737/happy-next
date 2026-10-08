import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const temp = mkdtempSync(join(tmpdir(), 'happy-claude-task-test-'));
vi.mock('@/configuration', () => ({ configuration: { happyHomeDir: temp } }));
const { prepareIsolatedClaudeHome } = await import('./claudeTaskIsolation');
afterEach(() => rmSync(join(temp, 'orchestrator-claude'), { recursive: true, force: true }));

it('binds Claude resume to its private exact session and canonical worktree', () => {
  const worktree = join(temp, 'worktree');
  mkdirSync(worktree, { recursive: true });
  const home = prepareIsolatedClaudeHome('task-1', worktree);
  const session = '11111111-2222-3333-4444-555555555555';
  expect(() => prepareIsolatedClaudeHome('task-1', worktree, session)).toThrow('private Claude session unavailable');
  mkdirSync(join(home, 'projects', 'project-1'), { recursive: true });
  writeFileSync(join(home, 'projects', 'project-1', `${session}.jsonl`), '{}\n');
  expect(prepareIsolatedClaudeHome('task-1', worktree, session)).toBe(home);
  expect(() => prepareIsolatedClaudeHome('task-1', temp, session)).toThrow('binding changed');
  expect(() => prepareIsolatedClaudeHome('task-2', worktree, session)).toThrow('private session unavailable');
});

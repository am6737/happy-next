import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ORCHESTRATOR_COMMAND_CLAUDE,
  ORCHESTRATOR_COMMAND_CODEX,
  ORCHESTRATOR_COMMAND_GEMINI,
  ORCHESTRATOR_SKILL_MD,
} from './skillAssets';

// Redirect homedir() to a per-test temp dir so the sync never touches the real ~/.claude / ~/.codex.
const hoisted = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => hoisted.home };
});

// Env keys that influence the sync — cleared per test for determinism, restored afterward.
const ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'HAPPY_ORCH_ONESHOT', 'HAPPY_ORCH_EXECUTION_ID'] as const;

describe('syncOrchestratorAssets', () => {
  let home: string;
  let savedEnv: Record<string, string | undefined>;

  const claudeSkill = () => join(home, '.claude', 'skills', 'orchestrator', 'SKILL.md');
  const claudeCmd = (provider: string) => join(home, '.claude', 'commands', 'orchestrator', `${provider}.md`);
  const codexSkill = () => join(home, '.codex', 'skills', 'orchestrator', 'SKILL.md');

  // Fresh module each run so the once-per-process guard (didSync) is reset.
  async function runSync(): Promise<void> {
    vi.resetModules();
    const mod = await import('./skillSync');
    mod.syncOrchestratorAssets();
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'orch-sync-'));
    hoisted.home = home;
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('writes nothing and creates no config dir when neither ~/.claude nor ~/.codex exists', async () => {
    await runSync();
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('populates ~/.claude and never creates ~/.codex when only ~/.claude exists', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    await runSync();
    expect(readFileSync(claudeSkill(), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(readFileSync(claudeCmd('claude'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CLAUDE);
    expect(readFileSync(claudeCmd('codex'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CODEX);
    expect(readFileSync(claudeCmd('gemini'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_GEMINI);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('populates ~/.codex and never creates ~/.claude when only ~/.codex exists', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    await runSync();
    expect(readFileSync(codexSkill(), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('populates both when both config dirs exist', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    await runSync();
    expect(existsSync(claudeSkill())).toBe(true);
    expect(existsSync(codexSkill())).toBe(true);
  });

  it('writes nothing for a worker (oneshot) session even when config dirs exist', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    process.env.HAPPY_ORCH_ONESHOT = '1';
    await runSync();
    expect(existsSync(claudeSkill())).toBe(false);
    expect(existsSync(codexSkill())).toBe(false);
  });

  it('honors CLAUDE_CONFIG_DIR for the claude target', async () => {
    const customDir = join(home, 'custom-claude');
    mkdirSync(customDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = customDir;
    await runSync();
    expect(existsSync(join(customDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });
});

describe('orchestrator skill frontmatter', () => {
  // Happy's frontmatter parser does not understand YAML block scalars; a folded `description: >-`
  // value is rendered literally as ">-" in the skill list. The description must stay a single-line
  // plain scalar so both Claude Code and Happy show it correctly.
  const descriptionLine = ORCHESTRATOR_SKILL_MD.split('\n').find((line) => line.startsWith('description:'));

  it('declares the skill description inline (no YAML block scalar that Happy cannot parse)', () => {
    expect(descriptionLine).toBeDefined();
    expect(descriptionLine).not.toMatch(/^description:\s*[>|]/);
  });

  it('carries non-empty description text on the same line', () => {
    expect(descriptionLine!.replace(/^description:\s*/, '').trim().length).toBeGreaterThan(0);
  });
});

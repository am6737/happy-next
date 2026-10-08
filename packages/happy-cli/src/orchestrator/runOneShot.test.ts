import { describe, expect, it, vi } from 'vitest';
import { codexPackage } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';

vi.mock('@/claude/claudeLocal', () => ({
  claudeCliPath: '/mock/claude.js',
}));
vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const { buildSpawnPlan } = await import('./runOneShot');

/** Whatever this machine resolves for the pinned Codex: a matching local binary or npx. */
const codexCommand = resolveCodexRuntime(codexPackage(), []).command;

describe('runOneShot spawn plan', () => {
  it('passes claude model and initial session-id arguments', () => {
    const plan = buildSpawnPlan('claude', 'hello', '/tmp/workdir', 'claude-sonnet-4-6', 'initial', 'session-uuid');
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('claude-sonnet-4-6');
    expect(plan.args).toEqual(expect.arrayContaining(['--session-id', 'session-uuid']));
    expect(plan.args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
    expect(plan.args).toContain('--restricted');
  });

  it('uses claude resume command for resume execution', () => {
    const plan = buildSpawnPlan('claude', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual(['/mock/claude.js', '--safe-mode', '--restricted', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--resume', 'session-uuid', '-p', 'continue']);
  });

  it('decomposes codex model mode into --model and -c model_reasoning_effort', () => {
    const plan = buildSpawnPlan('codex', 'hello', '/tmp/workdir', 'gpt-5.5-high', 'initial');
    expect(plan.command).toBe(codexCommand);
    expect(plan.args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--ask-for-approval', 'never']));
    expect(plan.args).toContain('--json');
    expect(plan.args).toContain('hello');
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('gpt-5.5');
    expect(plan.args).toContain('-c');
    expect(plan.args).toContain('model_reasoning_effort=high');
  });

  it('uses codex resume command for resume execution', () => {
    const plan = buildSpawnPlan('codex', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe(codexCommand);
    expect(plan.args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--ask-for-approval', 'never']));
    expect(plan.args).toContain('resume');
    expect(plan.args).toContain('--json');
    expect(plan.args).toContain('session-uuid');
    expect(plan.args).toContain('continue');
  });

  it('passes gemini model as --model argument and outputs json for initial session capture', () => {
    const plan = buildSpawnPlan('gemini', 'hello', '/tmp/workdir', 'gemini-2.5-pro', 'initial', undefined, 'read_only');
    expect(plan.command).toBe('gemini');
    expect(plan.args).toEqual(expect.arrayContaining(['--approval-mode', 'plan']));
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('hello');
    expect(plan.args).toContain('--output-format');
    expect(plan.args).toContain('stream-json');
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('gemini-2.5-pro');
  });

  it('uses gemini resume command for resume execution', () => {
    const plan = buildSpawnPlan('gemini', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid', 'read_only');
    expect(plan.command).toBe('gemini');
    expect(plan.args).toEqual(expect.arrayContaining(['--approval-mode', 'plan']));
    expect(plan.args).toContain('--resume');
    expect(plan.args).toContain('session-uuid');
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('continue');
  });

  it('maps AI team permission modes to provider safety flags', () => {
    expect(buildSpawnPlan('claude', 'read', undefined, undefined, 'initial', undefined, 'read_only').args)
      .toEqual(expect.arrayContaining(['--permission-mode', 'plan']));
    expect(() => buildSpawnPlan('codex', 'review', undefined, undefined, 'initial', undefined, 'approval'))
      .toThrow('interactive approval channel');
    expect(buildSpawnPlan('gemini', 'read', undefined, undefined, 'initial', undefined, 'read_only').args)
      .toEqual(expect.arrayContaining(['--approval-mode', 'plan']));
    expect(() => buildSpawnPlan('gemini', 'edit', undefined, undefined, 'initial', undefined, 'guarded_auto'))
      .toThrow('write sandbox is not verified');
  });
});

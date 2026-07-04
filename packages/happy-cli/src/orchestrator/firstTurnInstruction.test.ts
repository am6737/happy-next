import { describe, expect, it } from 'vitest';
import { getFirstTurnInstruction } from './firstTurnInstruction';

describe('first-turn instruction', () => {
  it('defaults to the Codex/Claude behavior: chat title only, no orchestrator block', () => {
    const instruction = getFirstTurnInstruction({} as NodeJS.ProcessEnv);

    expect(instruction).toContain('# Chat title');
    expect(instruction).not.toContain('# Orchestrator');
  });

  it('supports the Gemini behavior: include orchestrator guidance when requested', () => {
    const instruction = getFirstTurnInstruction({} as NodeJS.ProcessEnv, {
      includeOrchestrator: true,
    });

    expect(instruction).toContain('# Chat title');
    expect(instruction).toContain('# Orchestrator');
    expect(instruction).toContain('orchestrator_get_context');
  });

  it('returns no first-turn instruction for orchestrator worker sessions', () => {
    const instruction = getFirstTurnInstruction({ HAPPY_ORCH_ONESHOT: '1' } as NodeJS.ProcessEnv, {
      includeOrchestrator: true,
    });

    expect(instruction).toBe('');
  });
});

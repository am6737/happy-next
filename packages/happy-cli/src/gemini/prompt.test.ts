import { describe, expect, it } from 'vitest';
import { buildGeminiFirstTurnPrompt } from './prompt';

describe('buildGeminiFirstTurnPrompt', () => {
  it('puts system-like guidance before the user message', () => {
    expect(buildGeminiFirstTurnPrompt({
      appendSystemPrompt: '# Options',
      firstTurnInstruction: '# Chat title\n\n# Orchestrator',
      userMessage: 'Please fix the bug',
    })).toBe('# Options\n\n# Chat title\n\n# Orchestrator\n\nPlease fix the bug');
  });

  it('omits empty optional guidance', () => {
    expect(buildGeminiFirstTurnPrompt({
      appendSystemPrompt: '',
      firstTurnInstruction: null,
      userMessage: 'hello',
    })).toBe('hello');
  });
});

import { readFileSync } from 'node:fs';
import { TEAMMATE_ENV } from 'happy-wire';
import { getBaseSystemPrompt } from '@/orchestrator/prompt';

/**
 * System prompt for Claude controller sessions.
 *
 * Returns '' for worker sessions (getBaseSystemPrompt returns null).
 */
export const systemPrompt = (() => {
  const base = getBaseSystemPrompt();
  return base ?? '';
})();

// Module initialization occurs once at startup, not once per turn or mode switch.
export const teammateSystemPrompt = process.env[TEAMMATE_ENV.systemPromptFile]
  ? readFileSync(process.env[TEAMMATE_ENV.systemPromptFile]!, 'utf8')
  : '';

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

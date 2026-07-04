/**
 * Gemini Constants
 * 
 * Centralized constants for Gemini integration including environment variable names
 * and default values.
 */

import { getBaseSystemPrompt } from '@/orchestrator/prompt';

/** Environment variable name for Gemini API key */
export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';

/** Environment variable name for Google API key (alternative) */
export const GOOGLE_API_KEY_ENV = 'GOOGLE_API_KEY';

/** Environment variable name for Gemini model selection */
export const GEMINI_MODEL_ENV = 'GEMINI_MODEL';

/** Default Gemini model */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

/**
 * First-turn tool guidance shared by Codex + Gemini (controller sessions only).
 * Defaults to chat-title guidance only. Orchestrator guidance is opt-in via includeOrchestrator:
 * claude/codex discover the orchestrator through the synced skill, but gemini has no skill sync, so
 * gemini passes includeOrchestrator=true to keep it in the system prompt.
 */
export function getFirstTurnInstruction(
  env: NodeJS.ProcessEnv = process.env,
  includeOrchestrator: boolean = false,
): string {
  return getBaseSystemPrompt(env, includeOrchestrator) ?? '';
}

import { getBaseSystemPrompt } from './prompt';

export type FirstTurnInstructionOptions = {
  includeOrchestrator?: boolean;
};

/**
 * First-turn tool guidance for controller sessions.
 *
 * Defaults to chat-title guidance only. Orchestrator guidance is opt-in: claude/codex
 * discover the orchestrator through the synced skill, but gemini has no skill sync and
 * should pass includeOrchestrator=true to keep orchestrator guidance in the system prompt.
 */
export function getFirstTurnInstruction(
  env: NodeJS.ProcessEnv = process.env,
  options: FirstTurnInstructionOptions = {},
): string {
  return getBaseSystemPrompt(env, { includeOrchestrator: options.includeOrchestrator }) ?? '';
}

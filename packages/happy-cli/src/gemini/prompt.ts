export type BuildGeminiFirstTurnPromptOptions = {
  userMessage: string;
  appendSystemPrompt?: string | null;
  firstTurnInstruction?: string | null;
};

/**
 * Gemini ACP currently receives a single prompt string, so keep system-like guidance
 * before the user message to preserve instruction hierarchy as much as this transport allows.
 */
export function buildGeminiFirstTurnPrompt({
  userMessage,
  appendSystemPrompt,
  firstTurnInstruction,
}: BuildGeminiFirstTurnPromptOptions): string {
  return [appendSystemPrompt, firstTurnInstruction, userMessage]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n');
}

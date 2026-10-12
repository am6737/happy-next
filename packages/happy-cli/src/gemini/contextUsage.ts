/**
 * How full a Gemini conversation's context window is, for the app's context indicator.
 *
 * Over ACP, Gemini CLI reports only a whole turn's input tokens, summed over its
 * requests, which overstates the context of any turn that calls tools, and it sends
 * no usage_update. Its chat recording,
 * `$GEMINI_CLI_HOME/.gemini/tmp/<project>/chats/session-<time>-<session id prefix>.jsonl`,
 * gives each request's own input (`tokens.input`, cached tokens included), and
 * `.gemini/projects.json` names the project directory of each working directory.
 */

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getMaxContextSize } from 'happy-wire';
import { readTailLines } from '@/utils/readTailLines';

type GeminiMessage = { type?: string; model?: string; tokens?: { input?: number } };

/** The recording of `sessionId`, looked for in the project of `cwd`, else in every project. */
async function findChatFile(sessionId: string, cwd: string): Promise<string | null> {
  const geminiDir = join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini');
  const tmpDir = join(geminiDir, 'tmp');
  const projects = await readFile(join(geminiDir, 'projects.json'), 'utf8')
    .then((text) => (JSON.parse(text) as { projects?: Record<string, string> }).projects ?? {})
    .catch(() => ({} as Record<string, string>));
  const projectDirs = projects[cwd] ? [projects[cwd]] : await readdir(tmpDir).catch(() => []);
  for (const projectDir of projectDirs) {
    const chatsDir = join(tmpDir, projectDir, 'chats');
    const file = (await readdir(chatsDir).catch(() => []))
      .filter((name) => name === `session-${sessionId}.jsonl` || name.endsWith(`-${sessionId.slice(0, 8)}.jsonl`))
      .sort()
      .at(-1);
    if (file) return join(chatsDir, file);
  }
  return null;
}

/**
 * The context use of Gemini conversation `sessionId`, run in `cwd`, after its latest
 * request, or null when Gemini CLI has not recorded it.
 */
export async function readGeminiContextUsage(sessionId: string, cwd: string): Promise<{ usedTokens: number; windowSize: number } | null> {
  const file = await findChatFile(sessionId, cwd);
  if (!file) return null;
  for (const line of await readTailLines(file)) {
    if (!line.includes('"tokens"')) continue;
    // Messages are appended one per line, or set all at once when a recording is rewritten.
    const record = JSON.parse(line) as GeminiMessage & { $set?: { messages?: GeminiMessage[] } };
    const message = [...(record.$set?.messages ?? []), record].reverse()
      .find((candidate) => candidate.type === 'gemini' && (candidate.tokens?.input ?? 0) > 0);
    if (message) return { usedTokens: message.tokens!.input!, windowSize: getMaxContextSize(message.model, 'gemini') };
  }
  return null;
}

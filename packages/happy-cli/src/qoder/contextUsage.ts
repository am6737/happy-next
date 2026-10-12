/**
 * How full a Qoder conversation's context window is, for the app's context indicator.
 *
 * qodercli reports zero for every token count, over ACP and in its transcript, and
 * sends no usage_update. Its transcript does give the share of the window each request
 * used (`message.usage.context_usage_ratio`), and the run log of each qodercli process,
 * `<config>/logs/runs/<time>-p<pid>/qodercli.log`, gives the window of each request's
 * model (`model_config={"key":"<model>",…,"max_input_tokens":N}`).
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getMaxContextSize } from 'happy-wire';
import { findClaudeProjectId } from '@/claude/utils/claudeSessionIndex';
import { qoderTranscriptStore } from '@/qoder/transcripts';
import { readTailLines } from '@/utils/readTailLines';

const MODEL_CONFIG = /model_config=\{"key":"([^"]*)".*?"max_input_tokens":(\d+)/;

type TranscriptRecord = {
  type?: string;
  isSidechain?: boolean;
  message?: { model?: string; usage?: { context_usage_ratio?: number } };
};

/** The window qodercli process `pid` last logged for `model`, else for any model. */
async function readRunLogWindow(configDir: string, pid: number, model: string | undefined): Promise<number | undefined> {
  const runsDir = join(configDir, 'logs', 'runs');
  // Run directories start with their start time, so the last one is the newest process with this pid.
  const run = (await readdir(runsDir).catch(() => [])).filter((name) => name.endsWith(`-p${pid}`)).sort().at(-1);
  if (!run) return undefined;
  const windows = (await readTailLines(join(runsDir, run, 'qodercli.log')).catch(() => []))
    .flatMap((line) => {
      const match = line.match(MODEL_CONFIG);
      return match ? [{ model: match[1], window: Number(match[2]) }] : [];
    });
  return (windows.find((entry) => entry.model === model) ?? windows[0])?.window;
}

/**
 * The context use of Qoder conversation `sessionId` after its latest request, or null
 * when qodercli has not recorded it. `pid` is the qodercli process serving it.
 */
export async function readQoderContextUsage(sessionId: string, pid: number | undefined): Promise<{ usedTokens: number; windowSize: number } | null> {
  const store = qoderTranscriptStore();
  const projectId = await findClaudeProjectId(sessionId, store);
  if (!projectId) return null;
  for (const line of await readTailLines(join(store.configDir, 'projects', projectId, `${sessionId}.jsonl`))) {
    if (!line.includes('"context_usage_ratio"')) continue;
    const record = JSON.parse(line) as TranscriptRecord;
    const ratio = record.message?.usage?.context_usage_ratio;
    if (record.type !== 'assistant' || record.isSidechain || typeof ratio !== 'number' || ratio <= 0) continue;
    const model = record.message?.model;
    // Without the logged window the token count is only an estimate, but the share the app shows stays exact.
    const windowSize = (pid !== undefined ? await readRunLogWindow(store.configDir, pid, model) : undefined) ?? getMaxContextSize(model, 'qoder');
    return { usedTokens: Math.round(ratio * windowSize), windowSize };
  }
  return null;
}

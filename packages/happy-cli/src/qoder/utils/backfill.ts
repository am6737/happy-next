/**
 * Qoder Session Backfill
 *
 * ACP `session/load` replays the restored conversation as session updates. The
 * runner collects them while loading and this turns the user prompts and the text
 * each turn ended on into a message batch, so a resumed or copied session shows
 * its history in the app.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { stripQoderSessionInstructions } from '@/qoder/prompt';
import { forkedHistoryNotice, isInjectedPrompt, selectBackfillTurns } from '@/modules/common/backfillTurns';
import { stripAttachmentsFromPrompt } from '@/modules/common/fileUpload';

type BackfillMessage = { content: unknown; localId: string };

export function buildQoderBackfillMessages(updates: SessionNotification['update'][], sessionId: string, maxTurns = 20): BackfillMessage[] {
  // Chunks of one role run together into a message; a tool call ends the agent's, so the text after
  // the turn's last tool call is a message of its own — the reply the turn ended on.
  const entries: { role: 'user' | 'agent'; text: string; index: number }[] = [];
  let continues = false;
  for (const update of updates) {
    if (update.sessionUpdate === 'tool_call') {
      continues = false;
      continue;
    }
    if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') continue;
    if (update.content.type !== 'text') continue;
    const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'agent';
    const last = entries[entries.length - 1];
    if (continues && last?.role === role) {
      last.text += update.content.text;
    } else {
      entries.push({ role, text: update.content.text, index: entries.length });
    }
    continues = true;
  }

  const texts = entries
    .map((entry) => ({ ...entry, text: entry.role === 'user' ? stripAttachmentsFromPrompt(stripQoderSessionInstructions(entry.text)) : entry.text }))
    .filter((entry) => entry.text.trim().length > 0);
  const { selected, omittedTurns } = selectBackfillTurns(texts, (entry) => entry.role === 'agent' ? 'reply' : isInjectedPrompt(entry.text) ? null : 'prompt', maxTurns);
  const localIdPrefix = `qoder-log:${sessionId}:`;
  const notice = forkedHistoryNotice(localIdPrefix, omittedTurns);

  return [
    ...(notice ? [notice] : []),
    ...selected.map((entry) => ({
      localId: `${localIdPrefix}${entry.index}`,
      content: entry.role === 'user'
        ? { role: 'user', content: { type: 'text', text: entry.text }, meta: { sentFrom: 'cli' } }
        : { role: 'agent', content: { type: 'acp', provider: 'qoder', data: { type: 'message', message: entry.text } }, meta: { sentFrom: 'cli' } },
    })),
  ];
}

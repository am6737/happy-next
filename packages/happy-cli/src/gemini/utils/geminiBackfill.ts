/**
 * Gemini Session Backfill
 *
 * Reads a Gemini JSONL session file and sends historical messages
 * to the Happy app via message-batch, so the mobile UI shows
 * conversation history when a session is resumed or copied.
 */

import { logger } from '@/ui/logger';
import { readGeminiSessionLog } from './sessionReader';
import type { GeminiSessionLine } from './sessionTypes';
import { userPromptText } from 'happy-wire';
import { selectBackfillTurns, withForkedHistoryNotices } from '@/modules/common/backfillTurns';

export interface GeminiBackfillOptions {
    /** Gemini session ID (used to locate the JSONL file) */
    sessionId: string;
    /** Send the batch to the app */
    sendBatch: (messages: { content: unknown; localId: string }[]) => Promise<void>;
    /** Max turns to include (default: 20) */
    maxTurns?: number;
}

type TextLine = Extract<GeminiSessionLine, { type: 'user' | 'assistant' }>;

function buildMessageContent(line: TextLine): unknown {
    if (line.type === 'user') {
        return {
            role: 'user',
            content: { type: 'text', text: userPromptText(line.message) ?? line.message },
            meta: { sentFrom: 'cli' },
        };
    }
    return {
        role: 'agent',
        content: {
            type: 'acp',
            provider: 'gemini',
            data: { type: 'message', message: line.message },
        },
        meta: { sentFrom: 'cli' },
    };
}

export async function backfillGeminiSessionHistory(opts: GeminiBackfillOptions): Promise<void> {
    const allLines = await readGeminiSessionLog(opts.sessionId);
    const textLines = allLines.filter((line): line is TextLine =>
        (line.type === 'user' && userPromptText(line.message) !== null) || (line.type === 'assistant' && line.message.trim().length > 0));

    const { selected, omittedTurns } = selectBackfillTurns(textLines, (line) => line.type === 'user' ? 'prompt' : 'reply', opts.maxTurns ?? 20);
    const localIdPrefix = `gemini-log:${opts.sessionId}:`;
    const batch = withForkedHistoryNotices(localIdPrefix, omittedTurns, selected.map((line) => ({
        content: buildMessageContent(line),
        localId: `${localIdPrefix}${line.uuid}`,
    })));
    if (batch.length === 0) {
        logger.debug('[GEMINI-BACKFILL] No messages to backfill');
        return;
    }
    logger.debug(`[GEMINI-BACKFILL] Backfilling ${selected.length} messages (omitted turns: ${omittedTurns})`);

    await opts.sendBatch(batch);
}

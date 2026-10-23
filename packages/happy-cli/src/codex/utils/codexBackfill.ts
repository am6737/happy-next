/**
 * Codex Session Backfill
 *
 * Reads a Codex JSONL session file and sends historical messages
 * to the Happy app via message-batch, so the mobile UI shows
 * conversation history when a session is resumed or copied.
 */

import { basename, isAbsolute } from 'node:path';
import { logger } from '@/ui/logger';
import { userPromptText } from 'happy-wire';
import { selectBackfillTurns, withForkedHistoryNotices } from '@/modules/common/backfillTurns';
import {
    findCodexSessionFile,
    extractUserText,
    generateStableUuid,
    readCodexSessionContent,
} from './codexSessionReader';

export interface CodexBackfillOptions {
    /**
     * Codex session identifier — can be either:
     * - An absolute file path (from fork/duplicate, e.g. /home/user/.codex/sessions/.../rollout-xxx.jsonl)
     * - A session ID (matched via findCodexSessionFile)
     */
    sessionIdOrPath: string;
    /** Send the batch to the app */
    sendBatch: (messages: { content: unknown; localId: string }[]) => Promise<void>;
    /** Max turns to include (default: 20) */
    maxTurns?: number;
}

/**
 * Extract assistant text from a Codex response_item payload.
 */
function extractAssistantText(payload: any): string | null {
    const content = payload?.content;
    if (!content) return null;

    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const block of content) {
            if (block?.type === 'output_text' && typeof block.text === 'string') {
                texts.push(block.text);
            }
        }
        return texts.join('\n') || null;
    }

    return null;
}

interface ParsedCodexMessage {
    role: 'user' | 'assistant';
    text: string;
    timestamp: string;
    index: number;
}

function buildMessageContent(msg: ParsedCodexMessage): unknown {
    if (msg.role === 'user') {
        return {
            role: 'user',
            content: { type: 'text', text: msg.text },
            meta: { sentFrom: 'cli' },
        };
    }
    return {
        role: 'agent',
        content: {
            type: 'acp',
            provider: 'codex',
            data: { type: 'message', message: msg.text },
        },
        meta: { sentFrom: 'cli' },
    };
}

/**
 * Resolve sessionIdOrPath to an absolute file path.
 * If it looks like a file path (contains / and ends with .jsonl), use directly.
 * Otherwise treat as a session ID and search via findCodexSessionFile.
 */
function resolveCodexSessionFile(sessionIdOrPath: string): string | null {
    // Fork/duplicate passes an absolute file path; resume-by-id passes a session ID
    if (isAbsolute(sessionIdOrPath)) {
        return sessionIdOrPath;
    }
    return findCodexSessionFile(sessionIdOrPath);
}

export async function backfillCodexSessionHistory(opts: CodexBackfillOptions): Promise<void> {
    const filePath = resolveCodexSessionFile(opts.sessionIdOrPath);
    if (!filePath) {
        logger.debug(`[CODEX-BACKFILL] Session file not found for: ${opts.sessionIdOrPath}`);
        return;
    }

    let content: string;
    try {
        content = await readCodexSessionContent(filePath);
    } catch (error) {
        logger.debug(`[CODEX-BACKFILL] Failed to read file: ${filePath}`, error);
        return;
    }

    const lines = content.split('\n');
    const allMessages: ParsedCodexMessage[] = [];
    let msgIndex = 0;

    for (const line of lines) {
        if (!line.trim()) continue;

        let parsed: any;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }

        if (parsed.type !== 'response_item') continue;

        const payload = parsed.payload;
        const timestamp = parsed.timestamp || '';

        if (payload?.role === 'user') {
            const text = userPromptText(extractUserText(payload) ?? '');
            if (!text) continue;

            allMessages.push({
                role: 'user',
                text,
                timestamp,
                index: msgIndex++,
            });
        } else if (payload?.role === 'assistant') {
            const text = extractAssistantText(payload);
            if (!text) continue;

            allMessages.push({
                role: 'assistant',
                text,
                timestamp,
                index: msgIndex++,
            });
        }
    }

    const { selected, omittedTurns } = selectBackfillTurns(allMessages, (msg) => msg.role === 'user' ? 'prompt' : 'reply', opts.maxTurns ?? 20);

    // Use filename as stable key for localId deduplication
    const fileKey = basename(filePath, '.jsonl');
    const localIdPrefix = `codex-log:${fileKey}:`;
    const batch = withForkedHistoryNotices(localIdPrefix, omittedTurns, selected.map((msg) => ({
        content: buildMessageContent(msg),
        localId: `${localIdPrefix}${generateStableUuid(msg.timestamp, msg.index)}`,
    })));
    if (batch.length === 0) {
        logger.debug('[CODEX-BACKFILL] No messages to backfill');
        return;
    }
    logger.debug(`[CODEX-BACKFILL] Backfilling ${selected.length} messages (omitted turns: ${omittedTurns})`);

    await opts.sendBatch(batch);
}

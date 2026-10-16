import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RawJSONLines, RawJSONLinesSchema } from '@/claude/types';
import { getProjectPath } from './path';
import { logger } from '@/ui/logger';
import { forkedHistoryNotice, isInjectedPrompt, selectBackfillTurns, type BackfillRole } from '@/modules/common/backfillTurns';
import { stripAttachmentsFromPrompt } from '@/modules/common/fileUpload';

/** A transcript record to convert and send, or a message already built (the backfill's notice). */
export type ClaudeBackfillItem = { message: RawJSONLines; localId: string } | { content: unknown; localId: string };

const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

function messageKey(message: RawJSONLines): string {
    if (message.type === 'summary') {
        return `summary:${message.leafUuid}`;
    }
    return message.uuid;
}

const LOCAL_COMMAND_OUTPUT_PREFIX = '<local-command-stdout>';
const INTERRUPTED_PREFIX = '[Request interrupted';

/**
 * A prompt the user sent: typed text, a slash command, or a prompt with images. Not tool results,
 * the records Claude Code writes beside them (meta, compaction summaries, command output, an
 * interruption), or a prompt Happy handed it.
 */
function isPrompt(message: RawJSONLines): boolean {
    if (message.type !== 'user' || message.isSidechain || message.isMeta || message.isCompactSummary) return false;
    const content = message.message.content;
    if (typeof content === 'string') {
        return !isInjectedPrompt(content) && !content.trim().startsWith(LOCAL_COMMAND_OUTPUT_PREFIX);
    }
    return Array.isArray(content) && content.some((block: any) =>
        block?.type === 'image' || (block?.type === 'text' && typeof block.text === 'string' && !block.text.startsWith(INTERRUPTED_PREFIX)))
        && !content.some((block: any) => block?.type === 'tool_result');
}

function assistantTextBlocks(message: RawJSONLines): any[] {
    if (message.type !== 'assistant' || (message as any).isSidechain) return [];
    const content = message.message?.content;
    return Array.isArray(content) ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) : [];
}

function backfillRole(message: RawJSONLines): BackfillRole {
    if (isPrompt(message)) return 'prompt';
    return assistantTextBlocks(message).length > 0 ? 'reply' : null;
}

/** The prompt as the user typed it, and the reply as its text alone. */
function displayed(message: RawJSONLines): RawJSONLines {
    if (message.type === 'assistant') {
        return { ...message, message: { ...message.message, content: assistantTextBlocks(message) } } as RawJSONLines;
    }
    if (message.type !== 'user') return message;
    const content = message.message.content;
    return {
        ...message,
        message: {
            ...message.message,
            content: typeof content === 'string'
                ? stripAttachmentsFromPrompt(content)
                : content.map((block: any) => block?.type === 'text' && typeof block.text === 'string' ? { ...block, text: stripAttachmentsFromPrompt(block.text) } : block),
        },
    };
}

async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[BACKFILL] Reading session file: ${expectedSessionFile}`);
    let file: string;
    try {
        file = await readFile(expectedSessionFile, 'utf-8');
    } catch (error) {
        logger.debug(`[BACKFILL] Session file not found: ${expectedSessionFile}`);
        return [];
    }

    const lines = file.split('\n');
    const messages: RawJSONLines[] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const parsedLine = JSON.parse(line);
            if (parsedLine?.type && INTERNAL_CLAUDE_EVENT_TYPES.has(parsedLine.type)) {
                continue;
            }
            const parsed = RawJSONLinesSchema.safeParse(parsedLine);
            if (!parsed.success) {
                continue;
            }
            messages.push(parsed.data);
        } catch (error) {
            logger.debug('[BACKFILL] Failed to parse session line', { error });
        }
    }
    return messages;
}

export async function backfillClaudeSessionHistory(opts: {
    workingDirectory: string;
    sessionId: string;
    sendBatch: (items: ClaudeBackfillItem[]) => void | Promise<void>;
    maxTurns?: number;
}) {
    const projectDir = getProjectPath(opts.workingDirectory);
    let messages = await readSessionLog(projectDir, opts.sessionId);

    // Fallback: if resolve() path doesn't match Claude's projectId (e.g., symlinks), try raw path.
    if (!messages.length) {
        const rawProjectId = opts.workingDirectory.replace(/[\\\/\.: _]/g, '-');
        const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
        const rawProjectDir = join(claudeConfigDir, 'projects', rawProjectId);
        if (rawProjectDir !== projectDir) {
            messages = await readSessionLog(rawProjectDir, opts.sessionId);
        }
    }

    const { selected, omittedTurns } = selectBackfillTurns(messages, backfillRole, opts.maxTurns ?? 20);
    const localIdPrefix = `claude-log:${opts.sessionId}:`;
    const notice = forkedHistoryNotice(localIdPrefix, omittedTurns);
    if (!selected.length && !notice) {
        logger.debug('[BACKFILL] No messages to backfill');
        return;
    }
    logger.debug(`[BACKFILL] Backfilling ${selected.length} messages (omitted turns: ${omittedTurns})`);

    await opts.sendBatch([
        ...(notice ? [notice] : []),
        ...selected.map((message) => ({
            message: displayed(message),
            localId: `${localIdPrefix}${messageKey(message)}`,
        })),
    ]);
}

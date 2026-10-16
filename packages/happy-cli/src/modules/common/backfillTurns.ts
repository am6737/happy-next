/**
 * What a resumed or copied session shows of its history: the prompts the user sent and the reply
 * each one ended on, for the last few turns. The tool calls and working-out between them are left
 * out — they made a copy upload and the app decrypt megabytes for rows nobody reads there — and the
 * agent loses nothing by it, since it resumes its own transcript in full.
 */

import { randomUUID } from 'node:crypto';

// Texts Happy or the agent hands the agent as a prompt of its own: a run's terminal callback, a
// background task's report. The user never sent them and a live session never shows them.
const INJECTED_PROMPT_TAGS = ['task-notification', 'orchestrator-callback'];

export function isInjectedPrompt(text: string): boolean {
    const trimmed = text.trim();
    return INJECTED_PROMPT_TAGS.some((tag) => trimmed.startsWith(`<${tag}>`) && trimmed.includes(`</${tag}>`));
}

/** A history entry's part in a turn: the prompt that opens it, a reply, or neither. */
export type BackfillRole = 'prompt' | 'reply' | null;

/**
 * The last `maxTurns` turns of `items`, each as its prompt followed by its last reply, and how many
 * turns before them were left out. A turn runs from one prompt to the next, so when the agent spoke
 * again after an injected prompt — reporting a finished run — that report is the turn's last reply.
 */
export function selectBackfillTurns<T>(items: readonly T[], roleOf: (item: T) => BackfillRole, maxTurns: number): { selected: T[]; omittedTurns: number } {
    const turns: { prompt: T; reply: T | null }[] = [];
    for (const item of items) {
        const role = roleOf(item);
        if (role === 'prompt') {
            turns.push({ prompt: item, reply: null });
        } else if (role === 'reply' && turns.length > 0) {
            turns[turns.length - 1].reply = item;
        }
    }
    const kept = turns.slice(-maxTurns);
    return {
        selected: kept.flatMap((turn) => turn.reply === null ? [turn.prompt] : [turn.prompt, turn.reply]),
        omittedTurns: turns.length - kept.length,
    };
}

/**
 * The notice a backfill opens with: the session it was copied from (the app passes it when it copies
 * or resumes one; from an agent's own history list only its title) and how many earlier turns it
 * leaves out. None when it names no source and is not cut short.
 * `localIdPrefix` is the backfill's own, so a backfill that runs again replaces it with the rest.
 */
export function forkedHistoryNotice(localIdPrefix: string, omittedTurns: number): { content: unknown; localId: string } | null {
    const sourceSessionId = process.env.HAPPY_FORKED_FROM_SESSION_ID?.trim();
    const sourceTitle = process.env.HAPPY_FORKED_FROM_TITLE?.trim();
    if (!sourceSessionId && !sourceTitle && omittedTurns === 0) {
        return null;
    }
    return {
        localId: `${localIdPrefix}forked-history`,
        content: {
            role: 'agent',
            content: {
                id: randomUUID(),
                type: 'event',
                data: {
                    type: 'forked-history',
                    omittedTurns,
                    ...(sourceSessionId ? { sourceSessionId } : {}),
                    ...(sourceTitle ? { sourceTitle } : {}),
                },
            },
            meta: { sentFrom: 'cli' },
        },
    };
}
